import { NextResponse } from "next/server";
import { getSession, revokeCurrentSession } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await getSession();
  if (session) { assertCsrf(request, session.csrfTokenHash); await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: "LOGOUT", outcome: "SUCCESS" }); }
  await revokeCurrentSession(); return NextResponse.redirect(new URL("/login", request.url), 303);
}

