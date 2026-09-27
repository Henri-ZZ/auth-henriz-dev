import { NextResponse } from "next/server";
import { getSession, revokeCurrentSession } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { safePostLogoutRedirect } from "@/lib/sso";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await getSession();
  if (session) { assertCsrf(request, session.csrfTokenHash); await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: "LOGOUT", outcome: "SUCCESS" }); }
  await revokeCurrentSession();
  // RP-initiated logout: an app may ask to be returned to after the central
  // session is gone (`?redirect_uri=`); anything unregistered lands on /login.
  const target = await safePostLogoutRedirect(new URL(request.url).searchParams.get("redirect_uri"));
  return NextResponse.redirect(new URL(target, request.url), 303);
}
