import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __tripzyncPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const logLevels: Array<Prisma.LogLevel | Prisma.LogDefinition> =
    env.nodeEnv === "development" ? ["query", "info", "warn", "error"] : ["error"];

  if (env.databaseUrl.startsWith("prisma+postgres://")) {
    return new PrismaClient({
      accelerateUrl: env.databaseUrl,
      log: logLevels,
    });
  }

  const adapter = new PrismaPg({ connectionString: env.databaseUrl });

  return new PrismaClient({
    adapter,
    log: logLevels,
  });
}

export const prisma = globalThis.__tripzyncPrisma ?? createPrismaClient();

if (env.nodeEnv !== "production") {
  globalThis.__tripzyncPrisma = prisma;
}
