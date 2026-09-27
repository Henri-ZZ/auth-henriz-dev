import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac } from "@/lib/crypto";

export const rpName = "Henri Z Admin";

export async function authenticationOptions(adminId?: string, stepUp = false) {
  const passkeys = adminId ? await db.passkeyCredential.findMany({ where: { adminId, revokedAt: null } }) : [];
  const options = await generateAuthenticationOptions({
    rpID: env().WEBAUTHN_RP_ID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: adminId ? passkeys.map((item) => ({ id: item.credentialId, transports: item.transports as AuthenticatorTransport[] })) : [],
  });
  await db.webAuthnChallenge.create({ data: {
    adminId,
    kind: stepUp ? "STEP_UP" : "AUTHENTICATION",
    hash: hmac(env().CHALLENGE_HASH_KEY, options.challenge),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }});
  return options;
}

export async function registrationOptions(adminId: string) {
  const admin = await db.admin.findUniqueOrThrow({ where: { id: adminId }, include: { passkeys: { where: { revokedAt: null } } } });
  const options = await generateRegistrationOptions({
    rpName,
    rpID: env().WEBAUTHN_RP_ID,
    userName: admin.displayName,
    userDisplayName: admin.displayName,
    userID: new Uint8Array(admin.webauthnUserId),
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: admin.passkeys.map((item) => ({ id: item.credentialId, transports: item.transports as AuthenticatorTransport[] })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await db.webAuthnChallenge.create({ data: {
    adminId,
    kind: "REGISTRATION",
    hash: hmac(env().CHALLENGE_HASH_KEY, options.challenge),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }});
  return options;
}

export async function consumeChallenge(challenge: string, kinds: Array<"AUTHENTICATION" | "REGISTRATION" | "STEP_UP">) {
  const hash = hmac(env().CHALLENGE_HASH_KEY, challenge);
  return db.$transaction(async (tx) => {
    const found = await tx.webAuthnChallenge.findFirst({ where: { hash, kind: { in: kinds }, usedAt: null, expiresAt: { gt: new Date() } } });
    if (!found) throw new Error("invalid challenge");
    const result = await tx.webAuthnChallenge.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
    if (result.count !== 1) throw new Error("challenge already used");
    return found;
  });
}

