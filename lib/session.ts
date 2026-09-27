import { cookies } from "next/headers";
import type { Admin, AuthSession } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac, randomToken } from "@/lib/crypto";

export const SESSION_COOKIE = "__Host-henriz_auth";
const CSRF_COOKIE = "__Host-henriz_csrf";
const idleMs = 12 * 60 * 60 * 1000;
const absoluteMs = 7 * 24 * 60 * 60 * 1000;

export type SessionWithAdmin = AuthSession & { admin: Admin };

export async function createSession(admin: Admin, method: "PASSKEY" | "TOTP" | "BOOTSTRAP") {
  const token = randomToken();
  const csrf = randomToken();
  const now = new Date();
  const session = await db.authSession.create({ data: {
    adminId: admin.id,
    tokenHash: hmac(env().SESSION_HASH_KEY, token),
    csrfTokenHash: hmac(env().SESSION_HASH_KEY, csrf),
    authMethod: method,
    authenticatedAt: now,
    stepUpAt: now,
    idleExpiresAt: new Date(now.getTime() + idleMs),
    absoluteExpiresAt: new Date(now.getTime() + absoluteMs),
    sessionVersion: admin.sessionVersion,
  }});
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { secure: true, httpOnly: true, sameSite: "lax", path: "/", expires: session.absoluteExpiresAt });
  jar.set(CSRF_COOKIE, csrf, { secure: true, httpOnly: false, sameSite: "strict", path: "/", expires: session.absoluteExpiresAt });
  return session;
}

export async function getSession(): Promise<SessionWithAdmin | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = new Date();
  const session = await db.authSession.findUnique({ where: { tokenHash: hmac(env().SESSION_HASH_KEY, token) } });
  if (!session) return null;
  const admin = await db.admin.findUnique({ where: { id: session.adminId } });
  if (!admin || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now ||
      session.sessionVersion !== admin.sessionVersion || admin.status === "DISABLED") return null;
  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    void db.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + idleMs, session.absoluteExpiresAt.getTime())) } });
  }
  return { ...session, admin };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("authentication required");
  return session;
}

export function requireRecentStepUp(session: AuthSession, maxAgeMs = 5 * 60 * 1000) {
  if (!session.stepUpAt || Date.now() - session.stepUpAt.getTime() > maxAgeMs) throw new Error("recent step-up required");
}

export async function revokeCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.authSession.updateMany({ where: { tokenHash: hmac(env().SESSION_HASH_KEY, token), revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}
