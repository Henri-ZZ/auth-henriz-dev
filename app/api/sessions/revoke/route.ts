import { z } from "zod";
import { db } from "@/lib/db";
import { assertCsrf } from "@/lib/csrf";
import { json, publicError } from "@/lib/http";
import { requireRecentStepUp, requireSession } from "@/lib/session";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().optional(), all: z.boolean().optional() }).refine((v) => Boolean(v.sessionId) !== Boolean(v.all));
export async function POST(request: Request) {
  try { const session = await requireSession(); assertCsrf(request, session.csrfTokenHash); requireRecentStepUp(session); const body = schema.parse(await request.json()); if (body.all) { await db.admin.update({ where: { id: session.adminId }, data: { sessionVersion: { increment: 1 } } }); await db.authSession.updateMany({ where: { adminId: session.adminId, revokedAt: null }, data: { revokedAt: new Date() } }); } else { await db.authSession.updateMany({ where: { id: body.sessionId, adminId: session.adminId, revokedAt: null }, data: { revokedAt: new Date() } }); } await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: body.all ? "SESSIONS_REVOKED_ALL" : "SESSION_REVOKED", outcome: "SUCCESS" }); return json({ ok: true }); } catch (error) { return publicError(error); }
}

