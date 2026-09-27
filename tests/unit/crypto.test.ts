import { describe, expect, it } from "vitest";
import { decryptAesGcm, encryptAesGcm, hmac, randomToken, safeEqual } from "@/lib/crypto";

const key = Buffer.alloc(32, 7).toString("base64");
describe("cryptographic storage helpers", () => {
  it("creates high-entropy URL-safe tokens", () => { const token = randomToken(); expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); });
  it("hashes deterministically and compares safely", () => { expect(safeEqual(hmac(key, "one"), hmac(key, "one"))).toBe(true); expect(safeEqual(hmac(key, "one"), hmac(key, "two"))).toBe(false); });
  it("binds ciphertext to its AAD", () => { const encrypted = encryptAesGcm(Buffer.from("secret"), key, "admin|credential|totp"); expect(decryptAesGcm(encrypted, key, "admin|credential|totp").toString()).toBe("secret"); expect(() => decryptAesGcm(encrypted, key, "wrong")).toThrow(); });
});

