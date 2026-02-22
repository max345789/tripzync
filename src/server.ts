import app from "./app";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { logger } from "./utils/logger";

const server = app.listen(env.port, () => {
  logger.info(`Tripzync backend listening on http://localhost:${env.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn(`Received ${signal}. Shutting down...`);

  server.close(async (closeError) => {
    if (closeError) {
      logger.error("HTTP server close failed:", closeError);
      process.exit(1);
      return;
    }

    try {
      await prisma.$disconnect();
      process.exit(0);
    } catch (disconnectError) {
      logger.error("Prisma disconnect failed:", disconnectError);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("Forced shutdown due to timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
  void shutdown("UNHANDLED_REJECTION");
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  void shutdown("UNCAUGHT_EXCEPTION");
});
