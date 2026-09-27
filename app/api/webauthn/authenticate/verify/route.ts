import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, webauthnOrigins } from "@/lib/env";
import { json, publicError } from "@/lib/http";
import { consumeChallenge } from "@/lib/webauthn";
import { createSession, getSession } from "@/lib/session";
import { finishPendingAuthorize } from "@/lib/sso";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
const schema = z.object({ id: z.string().min(1).max(1024), rawId: z.string(), response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string(), userHandle: z.string().nullable().optional() }), type: z.literal("public-key"), clientExtensionResults: z.record(z.string(), z.unknown()).optional(), authenticatorAttachment: z.string().optional() });
export async function POST(request: Request) {
  try {
    const response = schema.parse(await request.json()) as AuthenticationResponseJSON;
    const credential = await db.passkeyCredential.findUnique({ where: { credentialId: response.id }, include: { admin: true } });
    if (!credential || credential.revokedAt || credential.admin.status === "DISABLED") return json({ error: "credential_not_found" }, { status: 404 });
    const activeSession = await getSession(); if (activeSession && activeSession.adminId !== credential.adminId) throw new Error("credential owner mismatch");
    const verification = await verifyAuthenticationResponse({ response,
      expectedChallenge: async (challenge) => { const row = await consumeChallenge(challenge, activeSession ? ["STEP_UP"] : ["AUTHENTICATION"]); return row.adminId ? row.adminId === credential.adminId : true; },
      expectedOrigin: webauthnOrigins(), expectedRPID: env().WEBAUTHN_RP_ID, requireUserVerification: true,
      credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: Number(credential.counter), transports: credential.transports },
    });
    if (!verification.verified) throw new Error("verification failed");
    await db.passkeyCredential.update({ where: { id: credential.id }, data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date(), deviceType: verification.authenticationInfo.credentialDeviceType, backedUp: verification.authenticationInfo.credentialBackedUp } });
    if (activeSession) { await db.authSession.update({ where: { id: activeSession.id }, data: { stepUpAt: new Date(), authMethod: "PASSKEY" } }); await audit(request, { adminId: credential.adminId, actorSessionId: activeSession.id, event: "STEP_UP", outcome: "SUCCESS" }); return json({ ok: true, redirectTo: "/security" }); }
    const sessionRecord = await createSession(credential.admin, "PASSKEY"); const session = { ...sessionRecord, admin: credential.admin };
    const redirectTo = await finishPendingAuthorize(session) || "/security";
    await audit(request, { adminId: credential.adminId, actorSessionId: session.id, event: "LOGIN_PASSKEY", outcome: "SUCCESS" });
    return json({ ok: true, redirectTo });
  } catch (error) { return publicError(error); }
}

