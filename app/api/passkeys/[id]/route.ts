import { z } from "zod";
import { db } from "@/lib/db";
import { assertCsrf } from "@/lib/csrf";
import { json, publicError } from "@/lib/http";
import { requireRecentStepUp, requireSession } from "@/lib/session";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const session = await requireSession(); assertCsrf(request, session.csrfTokenHash); const { id } = await context.params; const { name } = renameSchema.parse(await request.json()); const updated = await db.passkeyCredential.updateMany({ where: { id, adminId: session.adminId, revokedAt: null }, data: { name } }); if (updated.count !== 1) return json({ error: "not_found" }, { status: 404 }); return json({ ok: true }); } catch (error) { return publicError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(); assertCsrf(request, session.csrfTokenHash); requireRecentStepUp(session); const { id } = await context.params;
    const active = await db.passkeyCredential.count({ where: { adminId: session.adminId, revokedAt: null } });
    const totp = await db.totpCredential.findUnique({ where: { adminId: session.adminId } });
    if (active <= 1 && (!totp || totp.disabledAt)) return json({ error: "last_recovery_method" }, { status: 409 });
    const updated = await db.passkeyCredential.updateMany({ where: { id, adminId: session.adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (updated.count !== 1) return json({ error: "not_found" }, { status: 404 });
    await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: "PASSKEY_REVOKED", outcome: "SUCCESS", targetType: "passkey", targetId: id }); return json({ ok: true });
  } catch (error) { return publicError(error); }
}

