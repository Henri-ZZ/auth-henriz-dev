import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hmac } from "@/lib/crypto";
import { clientIp } from "@/lib/http";

export async function audit(request: Request, input: {
  adminId?: string;
  actorSessionId?: string;
  event: string;
  outcome: "SUCCESS" | "FAILURE";
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const ua = request.headers.get("user-agent") || "unknown";
  await db.auditLog.create({ data: {
    ...input,
    requestId: request.headers.get("x-vercel-id") || crypto.randomUUID(),
    ipPrefixHash: hmac(env().SESSION_HASH_KEY, clientIp(request)),
    userAgentHash: hmac(env().SESSION_HASH_KEY, ua),
  }});
}

