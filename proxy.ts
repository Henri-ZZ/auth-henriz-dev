import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const production = process.env.NODE_ENV === "production";
  const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}'${production ? "" : " 'unsafe-eval'"}`, `style-src 'self' 'nonce-${nonce}'`, "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"].join("; ");
  const headers = new Headers(request.headers); headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } }); response.headers.set("Content-Security-Policy", csp); response.headers.set("Cache-Control", "no-store, max-age=0"); return response;
}

export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }] };
