import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED;
const [command] = process.argv.slice(2);
const requiresDatabase = command === "migrate" || command === "db" || command === "studio";

if (!migrationUrl && requiresDatabase) {
  throw new Error("Set DIRECT_URL or Neon DATABASE_URL_UNPOOLED for Prisma migrations.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: migrationUrl ? { url: migrationUrl } : undefined,
});
