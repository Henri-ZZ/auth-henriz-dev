import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED;

if (!migrationUrl) {
  throw new Error("Set DIRECT_URL or Neon DATABASE_URL_UNPOOLED for Prisma migrations.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: migrationUrl },
});
