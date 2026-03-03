import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import authRoutes from "./routes/auth.routes";
import legalRoutes from "./routes/legal.routes";
import tripRoutes from "./routes/trip.routes";
import { AppError } from "./utils/app-error";
import { sendSuccess } from "./utils/api-response";
import { logger } from "./utils/logger";

const app = express();
const allowAllOrigins = env.corsOrigins.includes("*");
const allowedOriginSet = new Set(env.corsOrigins);

app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowAllOrigins || allowedOriginSet.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, "CORS_FORBIDDEN", "Origin is not allowed."));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    maxAge: 86_400,
  })
);

app.use(express.json({ limit: "1mb" }));

if (env.nodeEnv === "development") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

app.get("/health", (_req, res) => {
  return sendSuccess(res, {
    status: "ok",
    environment: env.nodeEnv,
    deployCommit: env.deployCommit,
  });
});

app.use("/", legalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", tripRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
