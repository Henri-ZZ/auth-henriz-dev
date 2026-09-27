import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, webauthnOrigins } from "@/lib/env";
import { assertCsrf } from "@/lib/csrf";
import { json, publicError } from "@/lib/http";
import { requireRecentStepUp, requireSession } from "@/lib/session";
import { consumeChallenge } from "@/lib/webauthn";
import { audit } from "@/lib/audit";
import { finishPendingAuthorize } from "@/lib/sso";
export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1).max(80), credential: z.object({ id: z.string(), rawId: z.string(), response: z.record(z.string(), z.unknown()), type: z.literal("public-key"), clientExtensionResults: z.record(z.string(), z.unknown()).optional(), authenticatorAttachment: z.string().optional() }) });
export async function POST(request: Request) {
  try {
    const session = await requireSession(); assertCsrf(request, session.csrfTokenHash); requireRecentStepUp(session); const body = schema.parse(await request.json());
    const verification = await verifyRegistrationResponse({ response: body.credential as unknown as RegistrationResponseJSON, expectedChallenge: async (challenge) => { const row = await consumeChallenge(challenge, ["REGISTRATION"]); return row.adminId === session.adminId; }, expectedOrigin: webauthnOrigins(), expectedRPID: env().WEBAUTHN_RP_ID, requireUserVerification: true });
    if (!verification.verified) throw new Error("verification failed"); const info = verification.registrationInfo;
    const [, activeAdmin, promotedSession] = await db.$transaction([
      db.passkeyCredential.create({ data: { adminId: session.adminId, credentialId: info.credential.id, publicKey: Buffer.from(info.credential.publicKey), counter: BigInt(info.credential.counter), transports: info.credential.transports || [], deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp, aaguid: info.aaguid, name: body.name } }),
      db.admin.update({ where: { id: session.adminId }, data: { status: "ACTIVE" } }),
      db.authSession.update({ where: { id: session.id }, data: { authMethod: "PASSKEY", authenticatedAt: new Date(), stepUpAt: new Date() } }),
    ]);
    const redirectTo = await finishPendingAuthorize({ ...promotedSession, admin: activeAdmin }) || "/security";
    await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: "PASSKEY_ADDED", outcome: "SUCCESS" }); return json({ ok: true, redirectTo });
  } catch (error) { return publicError(error); }
}
