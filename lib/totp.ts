import { verify } from "otplib";
import { db } from "@/lib/db";
import { decryptAesGcm } from "@/lib/crypto";
import { env } from "@/lib/env";

function keyForVersion(version: number) {
  const value = process.env[`TOTP_ENCRYPTION_KEY_V${version}`];
  if (!value) throw new Error("TOTP key version unavailable");
  return value;
}

export async function verifyTotp(adminId: string, token: string) {
  const credential = await db.totpCredential.findUnique({ where: { adminId } });
  const now = new Date();
  if (!credential || credential.disabledAt || (credential.lockedUntil && credential.lockedUntil > now)) return false;
  const aad = `${adminId}|${credential.id}|totp`;
  const secret = decryptAesGcm({ ciphertext: Buffer.from(credential.ciphertext), nonce: Buffer.from(credential.nonce), authTag: Buffer.from(credential.authTag) }, keyForVersion(credential.keyVersion), aad).toString("utf8");
  const result = await verify({ secret, token, epochTolerance: 30, afterTimeStep: credential.lastUsedTimeStep ? Number(credential.lastUsedTimeStep) : undefined });
  if (!result.valid) {
    const attempts = credential.failedAttempts + 1;
    await db.totpCredential.update({ where: { id: credential.id }, data: { failedAttempts: attempts, lockedUntil: attempts >= 10 ? new Date(Date.now() + 30 * 60 * 1000) : null } });
    return false;
  }
  const matchedTimeStep = Math.floor(Date.now() / 30_000) + result.delta;
  const updated = await db.totpCredential.updateMany({ where: { id: credential.id, OR: [{ lastUsedTimeStep: null }, { lastUsedTimeStep: { lt: BigInt(matchedTimeStep) } }] }, data: { lastUsedTimeStep: BigInt(matchedTimeStep), failedAttempts: 0, lockedUntil: null } });
  return updated.count === 1;
}

export function currentTotpEncryptionKey() {
  return { version: env().TOTP_ACTIVE_KEY_VERSION, key: keyForVersion(env().TOTP_ACTIVE_KEY_VERSION) };
}
