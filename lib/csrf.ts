import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/crypto";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(env().AUTH_BASE_URL).origin) throw new Error("invalid origin");
}

export function assertCsrf(request: Request, expectedHash: Uint8Array) {
  assertSameOrigin(request);
  const supplied = request.headers.get("x-csrf-token");
  if (!supplied || !safeEqual(hmac(env().SESSION_HASH_KEY, supplied), Buffer.from(expectedHash))) {
    throw new Error("invalid csrf token");
  }
}

