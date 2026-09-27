import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateSecret, generateURI, verify } from "otplib";
import { PrismaClient } from "../generated/prisma/client.js";
import { encryptAesGcm } from "../lib/crypto.js";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const encryptionKey = process.env.TOTP_ENCRYPTION_KEY_V1;
const keyVersion = Number(process.env.TOTP_ACTIVE_KEY_VERSION || 1);
if (!databaseUrl || !encryptionKey) throw new Error("DATABASE_URL_UNPOOLED (or DIRECT_URL) and TOTP_ENCRYPTION_KEY_V1 are required");

const requested = process.env.ADMIN_TOTP_SECRET?.trim();
const provided = requested?.startsWith("otpauth://")
  ? new URL(requested).searchParams.get("secret")?.trim() ?? ""
  : requested;
const secret = (provided || generateSecret()).replace(/\s+/g, "").toUpperCase();
const decodedBytes = Math.floor(secret.replace(/=+$/, "").length * 5 / 8);
if (!/^[A-Z2-7]+=*$/.test(secret) || decodedBytes < 16) {
  throw new Error(`ADMIN_TOTP_SECRET must be Base32 with at least 128 bits (26+ characters); got ${decodedBytes * 8} bits. otplib refuses shorter seeds.`);
}
try {
  await verify({ secret, token: "000000" });
} catch (error) {
  throw new Error(`otplib rejected ADMIN_TOTP_SECRET: ${error instanceof Error ? error.message : "unknown error"}`);
}
const uri = generateURI({ issuer: "Henri Z Auth", label: "admin", secret });

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const admin = await db.admin.findFirst({ orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No Admin found; use `pnpm db:seed` for the one-time bootstrap instead.");
  const activePasskeys = await db.passkeyCredential.count({ where: { adminId: admin.id, revokedAt: null } });
  const keepsStatus = activePasskeys > 0;
  if (dryRun) {
    console.log(`[dry-run] Admin ${admin.id} (${admin.displayName}), status ${admin.status}, ${activePasskeys} active passkey(s)`);
    console.log(`[dry-run] Would replace the TOTP credential, revoke all central sessions, bump sessionVersion${keepsStatus ? "" : " and set status BOOTSTRAP_REQUIRED"}, so the admin can register Passkeys after recovery.`);
    console.log(`[dry-run] New seed was NOT stored. It would be:\n  ${provided ? "(from ADMIN_TOTP_SECRET)" : uri}`);
    process.exitCode = 0;
  } else {
    const totpId = `totp_${randomUUID().replaceAll("-", "")}`;
    const encrypted = encryptAesGcm(Buffer.from(secret, "utf8"), encryptionKey, `${admin.id}|${totpId}|totp`);
    const now = new Date();
    await db.$transaction([
      db.totpCredential.deleteMany({ where: { adminId: admin.id } }),
      db.totpCredential.create({ data: { id: totpId, adminId: admin.id, ciphertext: new Uint8Array(encrypted.ciphertext), nonce: new Uint8Array(encrypted.nonce), authTag: new Uint8Array(encrypted.authTag), keyVersion } }),
      db.admin.update({ where: { id: admin.id }, data: keepsStatus ? { sessionVersion: { increment: 1 } } : { sessionVersion: { increment: 1 }, status: "BOOTSTRAP_REQUIRED" } }),
      db.authSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now } }),
      db.webAuthnChallenge.deleteMany({ where: { OR: [{ usedAt: null }, { expiresAt: { lt: now } }] } }),
      db.authorizationTransaction.deleteMany({ where: { usedAt: null } }),
      db.authorizationCode.deleteMany({ where: { usedAt: null } }),
      db.auditLog.create({ data: { adminId: admin.id, event: "TOTP_RESET", outcome: "SUCCESS", targetType: "TotpCredential", targetId: totpId, metadata: { source: "cli", activePasskeys } } }),
    ]);
    console.log(`Replaced the TOTP credential (key version ${keyVersion}), revoked all central sessions, cleared pending challenges/codes.`);
    console.log(`Admin status is now ${keepsStatus ? admin.status : "BOOTSTRAP_REQUIRED"}; ${activePasskeys} active passkey(s) were left untouched.`);
    if (provided) {
      console.log("Seed taken from ADMIN_TOTP_SECRET; it was not printed.");
    } else {
      console.log(`New seed - add it to your authenticator app now and keep it in your password manager:\n  ${uri}`);
    }
    console.log("Next: open /recovery, submit a fresh 6-digit code, then register two Passkeys in /security.");
  }
} finally { await db.$disconnect(); }
