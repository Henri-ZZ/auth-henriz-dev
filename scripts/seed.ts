import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { encryptAesGcm, hmac } from "../lib/crypto.js";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const totpSecret = process.env.ADMIN_TOTP_SECRET;
const encryptionKey = process.env.TOTP_ENCRYPTION_KEY_V1;
const authCodeKey = process.env.AUTH_CODE_HASH_KEY;
if (!databaseUrl || !totpSecret || !encryptionKey || !authCodeKey) throw new Error("DIRECT_URL, ADMIN_TOTP_SECRET, TOTP_ENCRYPTION_KEY_V1 and AUTH_CODE_HASH_KEY are required");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const existing = await db.admin.findFirst();
  if (existing) throw new Error("An Admin already exists; seed is intentionally one-time");
  const adminId = `adm_${randomUUID().replaceAll("-", "")}`;
  const totpId = `totp_${randomUUID().replaceAll("-", "")}`;
  const encrypted = encryptAesGcm(Buffer.from(totpSecret, "utf8"), encryptionKey, `${adminId}|${totpId}|totp`);
  await db.admin.create({ data: {
    id: adminId,
    webauthnUserId: new Uint8Array(randomBytes(32)),
    displayName: process.env.ADMIN_DISPLAY_NAME || "Henri Z",
    status: "BOOTSTRAP_REQUIRED",
    totp: { create: { id: totpId, ciphertext: new Uint8Array(encrypted.ciphertext), nonce: new Uint8Array(encrypted.nonce), authTag: new Uint8Array(encrypted.authTag), keyVersion: 1 } },
  }});
  const clients = process.env.CLIENTS_JSON ? JSON.parse(process.env.CLIENTS_JSON) as Array<{ clientId: string; name: string; secret: string; redirectUris: string[] }> : [];
  for (const client of clients) {
    if (client.secret.length < 32) throw new Error(`Client secret for ${client.clientId} must be high entropy`);
    await db.client.create({ data: { clientId: client.clientId, name: client.name, secretHash: hmac(authCodeKey, client.secret), redirectUris: client.redirectUris } });
  }
  console.log(`Created the single Admin and ${clients.length} client registration(s). Secrets were not printed.`);
} finally { await db.$disconnect(); }

