import { z } from "zod";
import { db } from "@/lib/db";
import { json, publicError } from "@/lib/http";
import { verifyTotp } from "@/lib/totp";
import { createSession } from "@/lib/session";
import { finishPendingAuthorize } from "@/lib/sso";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
const schema = z.object({ token: z.string().regex(/^\d{6}$/) });
export async function POST(request: Request) {
  try {
    const { token } = schema.parse(await request.json());
    const admin = await db.admin.findFirst({ where: { status: { not: "DISABLED" }, totp: { is: { disabledAt: null } } } });
    if (!admin || !(await verifyTotp(admin.id, token))) { if (admin) await audit(request, { adminId: admin.id, event: "LOGIN_TOTP", outcome: "FAILURE" }); return json({ error: "invalid_code" }, { status: 400 }); }
    const session = { ...(await createSession(admin, "TOTP")), admin };
    const redirectTo = await finishPendingAuthorize(session) || "/security";
    await audit(request, { adminId: admin.id, actorSessionId: session.id, event: "LOGIN_TOTP", outcome: "SUCCESS" });
    return json({ ok: true, redirectTo });
  } catch (error) { return publicError(error); }
}
