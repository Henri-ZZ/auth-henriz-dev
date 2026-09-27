import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init.headers },
  });
}

export function publicError(error: unknown) {
  if (error instanceof ZodError) {
    console.error("Invalid request payload", error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`).join(", "));
    return json({ error: "invalid_request" }, { status: 400 });
  }
  console.error("Authentication request failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: "request_failed" }, { status: 400 });
}

export function clientIp(request: Request): string {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

