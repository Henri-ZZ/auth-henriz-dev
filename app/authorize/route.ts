import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createAuthorizeTransaction, issueCode, validateAuthorize } from "@/lib/sso";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const input = await validateAuthorize(new URL(request.url).searchParams);
    const session = await getSession();
    if (session?.admin.status === "ACTIVE" && session.authMethod === "PASSKEY") return NextResponse.redirect(await issueCode(input, session), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    await createAuthorizeTransaction(input);
    return NextResponse.redirect(new URL(session ? "/security" : "/login", env().AUTH_BASE_URL), 303);
  } catch { return new NextResponse("Invalid authorization request", { status: 400, headers: { "Cache-Control": "no-store" } }); }
}
