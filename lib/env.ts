import { z } from "zod";

const base64Key = z.string().refine((value) => {
  try { return Buffer.from(value, "base64").byteLength >= 32; } catch { return false; }
}, "must be a base64-encoded key of at least 32 bytes");

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  AUTH_BASE_URL: z.string().url(),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_ORIGINS: z.string().min(1),
  SESSION_HASH_KEY: base64Key,
  AUTH_CODE_HASH_KEY: base64Key,
  CHALLENGE_HASH_KEY: base64Key,
  TOTP_ENCRYPTION_KEY_V1: base64Key,
  TOTP_ACTIVE_KEY_VERSION: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      // A plain Error, never a ZodError: misconfigured environment variables must not be
      // reported to clients as an "invalid_request" payload error.
      throw new Error(`Invalid environment configuration -> ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function webauthnOrigins(): string[] {
  return env().WEBAUTHN_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean);
}

