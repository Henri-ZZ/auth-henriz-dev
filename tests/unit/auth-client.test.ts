import { describe, expect, it } from "vitest";
import { createHenrizAuthClient, sanitizeReturnTo } from "../../sdk/henriz-auth-client";

const client = createHenrizAuthClient({
  baseUrl: "https://auth.henriz.dev",
  clientId: "demo-admin",
  clientSecret: "s".repeat(32),
  redirectUri: "https://demo.example.com/auth/callback",
});

describe("sanitizeReturnTo", () => {
  it("keeps same-origin relative paths", () => { expect(sanitizeReturnTo("/admin?tab=keys#x")).toBe("/admin?tab=keys#x"); });
  it("falls back for protocol-relative, absolute, backslash and control characters", () => {
    expect(sanitizeReturnTo("//evil.example.com")).toBe("/");
    expect(sanitizeReturnTo("https://evil.example.com")).toBe("/");
    expect(sanitizeReturnTo("admin")).toBe("/");
    expect(sanitizeReturnTo("/a\\b")).toBe("/");
    expect(sanitizeReturnTo("/a\u0000b")).toBe("/");
    expect(sanitizeReturnTo(null, "/home")).toBe("/home");
  });
});

describe("login transaction", () => {
  it("builds a PKCE S256 authorize URL with a host-only HttpOnly transaction cookie", () => {
    const { authorizeUrl, cookie } = client.beginLogin("/admin");
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe("https://auth.henriz.dev");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("demo-admin");
    expect(url.searchParams.get("redirect_uri")).toBe("https://demo.example.com/auth/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9._~-]{32,512}$/);
    expect(cookie.name).toBe("__Host-demo-admin_oauth");
    expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("stores a sanitized returnTo inside the transaction", () => {
    const { cookie } = client.beginLogin("//evil.example.com");
    const payload = JSON.parse(Buffer.from(cookie.value, "base64url").toString("utf8")) as { returnTo: string };
    expect(payload.returnTo).toBe("/");
  });

  it("rejects mismatched, malformed and missing transactions without calling the service", async () => {
    const { cookie } = client.beginLogin("/admin");
    const state = (JSON.parse(Buffer.from(cookie.value, "base64url").toString("utf8")) as { state: string }).state;
    const code = "c".repeat(43);
    await expect(client.completeLogin({ code, state: "x".repeat(32), transaction: cookie.value })).resolves.toEqual({ ok: false, reason: "state_mismatch" });
    await expect(client.completeLogin({ code, state, transaction: "garbage" })).resolves.toEqual({ ok: false, reason: "state_mismatch" });
    await expect(client.completeLogin({ code: null, state, transaction: cookie.value })).resolves.toEqual({ ok: false, reason: "state_mismatch" });
    await expect(client.completeLogin({ code, state, transaction: undefined })).resolves.toEqual({ ok: false, reason: "state_mismatch" });
  });
});
