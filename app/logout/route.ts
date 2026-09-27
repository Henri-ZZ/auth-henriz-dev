import { NextResponse } from "next/server";
import { getSession, revokeCurrentSession } from "@/lib/session";
import { audit } from "@/lib/audit";
export const runtime = "nodejs";

/**
 * Central logout — hitting this URL *is* the logout.
 *
 * Browsing to /logout revokes the current central session, clears the cookies,
 * and hands the browser to /signed-out, which is a plain "已退出登录" screen.
 * No confirmation step and no redirect back to the app that started it: the
 * app's own login page redirects into SSO again, so returning there would sign
 * the user straight back in.
 *
 * The state change happens on GET so it can be reached with a plain link or a
 * full page load. That makes "forced logout" CSRF possible (an attacker can
 * embed the URL), which costs the user one re-authentication — accepted here;
 * nothing else can be triggered by this route.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (session) {
    await audit(request, { adminId: session.adminId, actorSessionId: session.id, event: "LOGOUT", outcome: "SUCCESS" });
  }
  await revokeCurrentSession();
  return NextResponse.redirect(new URL("/signed-out", request.url), 303);
}
