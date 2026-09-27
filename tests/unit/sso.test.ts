import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPkce } from "@/lib/pkce";

describe("PKCE", () => {
  it("accepts the matching S256 verifier", () => { const verifier = "x".repeat(64); const challenge = createHash("sha256").update(verifier).digest("base64url"); expect(verifyPkce(verifier, challenge)).toBe(true); });
  it("rejects mismatches and short verifiers", () => { const challenge = createHash("sha256").update("x".repeat(64)).digest("base64url"); expect(verifyPkce("y".repeat(64), challenge)).toBe(false); expect(verifyPkce("short", challenge)).toBe(false); });
});
