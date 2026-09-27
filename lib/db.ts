import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let instance: PrismaClient | undefined;

function createClient() {
  const adapter = new PrismaPg({
    connectionString: env().DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: process.env.NODE_ENV === "production" ? 5 : 2,
  });
  return new PrismaClient({ adapter });
}

// The client is built on first use: `next build` imports every route module to collect
// page data, and that must not require DATABASE_URL or any other runtime secret.
function client(): PrismaClient {
  instance ??= globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = instance;
  return instance;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const source = client();
    const value = Reflect.get(source, property) as unknown;
    return typeof value === "function" ? value.bind(source) : value;
  },
});

