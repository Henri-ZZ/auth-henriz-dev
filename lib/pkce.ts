import { createHash } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return safeEqual(new Uint8Array(createHash("sha256").update(verifier).digest()), new Uint8Array(Buffer.from(challenge, "base64url")));
}
