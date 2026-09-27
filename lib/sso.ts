import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac, randomToken } from "@/lib/crypto";
import type { SessionWithAdmin } from "@/lib/session";

export const TRANSACTION_COOKIE = "__Host-henriz_tx";

export interface AuthorizeRequest { clientId: string; redirectUri: string; state: string; codeChallenge: string; }

export async function validateAuthorize(search: URLSearchParams): Promise<AuthorizeRequest & { clientDbId: string }> {
  if (search.get("response_type") !== "code" || search.get("code_challenge_method") !== "S256") throw new Error("unsupported authorize request");
  const clientId = search.get("client_id") || "";
  const redirectUri = search.get("redirect_uri") || "";
  const state = search.get("state") || "";
  const codeChallenge = search.get("code_challenge") || "";
  if (state.length < 32 || state.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(state)) throw new Error("invalid state");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw new Error("invalid code challenge");
  const client = await db.client.findUnique({ where: { clientId } });
  if (!client?.active || !client.redirectUris.includes(redirectUri)) throw new Error("invalid client or redirect URI");
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("redirect URI must use HTTPS");
  return { clientId, clientDbId: client.id, redirectUri, state, codeChallenge };
}

export async function createAuthorizeTransaction(input: AuthorizeRequest & { clientDbId: string }) {
  const raw = randomToken();
  await db.authorizationTransaction.create({ data: { browserTokenHash: hmac(env().CHALLENGE_HASH_KEY, raw), clientId: input.clientDbId, redirectUri: input.redirectUri, state: input.state, codeChallenge: input.codeChallenge, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  (await cookies()).set(TRANSACTION_COOKIE, raw, { secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
}

export async function issueCode(input: AuthorizeRequest & { clientDbId: string }, session: SessionWithAdmin) {
  const raw = randomToken();
  await db.authorizationCode.create({ data: { codeHash: hmac(env().AUTH_CODE_HASH_KEY, raw), adminId: session.adminId, clientId: input.clientDbId, authSessionId: session.id, redirectUri: input.redirectUri, codeChallenge: input.codeChallenge, authTime: session.authenticatedAt, expiresAt: new Date(Date.now() + 60_000) } });
  const callback = new URL(input.redirectUri);
  callback.searchParams.set("code", raw); callback.searchParams.set("state", input.state);
  return callback.toString();
}

export async function finishPendingAuthorize(session: SessionWithAdmin): Promise<string | null> {
  const jar = await cookies(); const raw = jar.get(TRANSACTION_COOKIE)?.value;
  if (!raw) return null;
  const tx = await db.authorizationTransaction.findUnique({ where: { browserTokenHash: hmac(env().CHALLENGE_HASH_KEY, raw) } });
  if (!tx || tx.usedAt || tx.expiresAt <= new Date()) { jar.delete(TRANSACTION_COOKIE); return null; }
  const consumed = await db.authorizationTransaction.updateMany({ where: { id: tx.id, usedAt: null }, data: { usedAt: new Date(), adminId: session.adminId } });
  if (consumed.count !== 1) throw new Error("authorize transaction already used");
  jar.delete(TRANSACTION_COOKIE);
  const client = await db.client.findUniqueOrThrow({ where: { id: tx.clientId } });
  return issueCode({ clientId: client.clientId, clientDbId: client.id, redirectUri: tx.redirectUri, state: tx.state, codeChallenge: tx.codeChallenge }, session);
}

/**
 * RP-initiated logout: after the central session is revoked the browser is sent
 * back to the app that asked for it. Only same-origin relative paths, or an
 * origin belonging to a registered active client, are accepted — everything
 * else falls back to the auth login page instead of becoming an open redirect.
 */
export async function safePostLogoutRedirect(raw: string | null | undefined, fallback = "/login"): Promise<string> {
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  let url: URL;
  try { url = new URL(raw); } catch { return fallback; }
  if (url.protocol !== "https:" && url.hostname !== "localhost") return fallback;
  const clients = await db.client.findMany({ where: { active: true }, select: { redirectUris: true } });
  const origins = new Set<string>();
  for (const client of clients) {
    for (const uri of client.redirectUris) {
      try { origins.add(new URL(uri).origin); } catch { /* ignore malformed rows */ }
    }
  }
  return origins.has(url.origin) ? url.toString() : fallback;
}
