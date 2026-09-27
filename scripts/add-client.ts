import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { hmac } from "../lib/crypto.js";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const authCodeKey = process.env.AUTH_CODE_HASH_KEY;
if (!databaseUrl || !authCodeKey) throw new Error("DATABASE_URL_UNPOOLED (or DIRECT_URL) and AUTH_CODE_HASH_KEY are required");

const flag = (name: string) => process.argv.includes(`--${name}`);
const value = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index === -1 ? undefined : process.argv[index + 1]; };
const values = (name: string) => process.argv.flatMap((item, index) => (item === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []));
const usage = "usage: pnpm db:add-client --client-id <id> [--name <name>] [--redirect <uri>]... [--rotate] [--disable|--enable] | --list";

function generateSecret() {
  const candidate = process.env.CLIENT_SECRET?.trim() || randomBytes(32).toString("base64url");
  if (candidate.length < 32) throw new Error("CLIENT_SECRET must be at least 32 characters");
  return candidate;
}

function validateRedirect(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error(`redirect URI must use HTTPS (localhost allowed for development): ${uri}`);
  if (parsed.hash || parsed.username || parsed.password) throw new Error(`redirect URI must not contain fragment or credentials: ${uri}`);
  return uri;
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  if (flag("list")) {
    const clients = await db.client.findMany({ orderBy: { createdAt: "asc" } });
    if (clients.length === 0) console.log("No clients registered.");
    for (const item of clients) console.log(`${item.active ? "active  " : "disabled"} ${item.clientId}  ${item.name}  [${item.redirectUris.join(", ")}]  updated ${item.updatedAt.toISOString()}`);
  } else {
    const clientId = value("client-id");
    if (!clientId || !/^[A-Za-z0-9._-]{3,64}$/.test(clientId)) throw new Error(`--client-id (3-64 chars of [A-Za-z0-9._-]) is required\n${usage}`);
    const name = value("name");
    const redirectUris = values("redirect").map(validateRedirect);
    const rotate = flag("rotate");
    const existing = await db.client.findUnique({ where: { clientId } });

    if (!existing) {
      if (!name || redirectUris.length === 0) throw new Error(`creating a client needs --name and at least one --redirect\n${usage}`);
      const secret = generateSecret();
      await db.client.create({ data: { clientId, name, redirectUris, secretHash: hmac(authCodeKey, secret), active: !flag("disable") } });
      console.log(`Registered client ${clientId} (${name})`);
      console.log(`  redirect URIs: ${redirectUris.join(", ")}`);
      console.log(`  client secret (shown once, put it in the app's server environment):\n  ${secret}`);
      console.log("  The app needs HENRIZ_AUTH_CLIENT_ID / HENRIZ_AUTH_CLIENT_SECRET; never expose the secret to the browser.");
    } else {
      const newSecret = rotate ? generateSecret() : undefined;
      const graceHours = Number(process.env.CLIENT_SECRET_GRACE_HOURS ?? 24);
      const data = {
        ...(name ? { name } : {}),
        ...(redirectUris.length > 0 ? { redirectUris } : {}),
        ...(flag("disable") ? { active: false } : {}),
        ...(flag("enable") ? { active: true } : {}),
        ...(newSecret ? { secretHash: hmac(authCodeKey, newSecret), previousSecretHash: existing.secretHash, previousValidUntil: new Date(Date.now() + graceHours * 60 * 60 * 1000) } : {}),
      };
      if (Object.keys(data).length === 0) throw new Error(`nothing to change for ${clientId}; pass --name/--redirect/--rotate/--disable/--enable\n${usage}`);
      await db.client.update({ where: { clientId }, data });
      console.log(`Updated client ${clientId}: ${Object.keys(data).join(", ")}`);
      if (newSecret) {
        console.log(`  Old secret keeps working until ${data.previousValidUntil?.toISOString()} (grace window).`);
        console.log(`  New client secret (shown once, deploy it to the app before the window closes):\n  ${newSecret}`);
      }
      if (redirectUris.length > 0) console.log(`  redirect URIs: ${redirectUris.join(", ")}`);
      if (flag("disable")) console.log("  Client disabled: every code exchange for it now fails immediately.");
    }
  }
} finally { await db.$disconnect(); }
