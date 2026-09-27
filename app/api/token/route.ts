import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/crypto";
import type { Client } from "@/generated/prisma/client";
import { json } from "@/lib/http";
import { verifyPkce } from "@/lib/pkce";
export const runtime = "nodejs";
const formSchema = z.object({ grant_type: z.literal("authorization_code"), code: z.string().min(40).max(200), redirect_uri: z.string().url().max(2048), code_verifier: z.string().min(43).max(128) });
function matchesSecret(client: Client, secret: string) {
  const key = env().AUTH_CODE_HASH_KEY;
  if (safeEqual(hmac(key, secret), Buffer.from(client.secretHash))) return true;
  if (!client.previousSecretHash || !client.previousValidUntil || client.previousValidUntil <= new Date()) return false;
  return safeEqual(hmac(key, secret), Buffer.from(client.previousSecretHash));
}
function basicAuth(request: Request) {
  const value = request.headers.get("authorization"); if (!value?.startsWith("Basic ")) throw new Error("invalid client authentication");
  const decoded = Buffer.from(value.slice(6), "base64").toString("utf8"); const split = decoded.indexOf(":");
  if (split < 1) throw new Error("invalid client authentication"); return { clientId: decoded.slice(0, split), secret: decoded.slice(split + 1) };
}
export async function POST(request: Request) {
  try {
    const auth = basicAuth(request); const form = formSchema.parse(Object.fromEntries(await request.formData()));
    const client = await db.client.findUnique({ where: { clientId: auth.clientId } });
    if (!client?.active || !matchesSecret(client, auth.secret)) throw new Error("invalid client");
    const code = await db.$transaction(async (tx) => {
      const found = await tx.authorizationCode.findUnique({ where: { codeHash: hmac(env().AUTH_CODE_HASH_KEY, form.code) } });
      if (!found || found.clientId !== client.id || found.redirectUri !== form.redirect_uri || found.expiresAt <= new Date() || found.usedAt || !verifyPkce(form.code_verifier, found.codeChallenge)) throw new Error("invalid grant");
      const consumed = await tx.authorizationCode.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      if (consumed.count !== 1) throw new Error("invalid grant"); return found;
    });
    const centralSession = await db.authSession.findUnique({ where: { id: code.authSessionId }, select: { authMethod: true } });
    return json({ sub: code.adminId, auth_time: Math.floor(code.authTime.getTime() / 1000), auth_method: centralSession?.authMethod.toLowerCase() ?? "passkey", central_session_id: code.authSessionId, issued_at: Math.floor(Date.now() / 1000) }, { headers: { "Henriz-Auth-Version": "1" } });
  } catch { return json({ error: "invalid_grant" }, { status: 400, headers: { "WWW-Authenticate": "Basic realm=henriz-auth" } }); }
}
