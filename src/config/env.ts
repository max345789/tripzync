import "dotenv/config";

export type NodeEnv = "development" | "test" | "production";

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }

  return "development";
}

function parsePort(value: string | undefined): number {
  if (!value) return 5050;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("Invalid PORT. Expected integer between 1 and 65535.");
  }

  return parsed;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function parseCorsOrigins(value: string | undefined, nodeEnv: NodeEnv): string[] {
  const configured = value?.trim() || "*";
  const origins = configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ORIGIN must contain at least one origin.");
  }

  if (nodeEnv === "production" && origins.includes("*")) {
    throw new Error("CORS_ORIGIN cannot contain '*' in production.");
  }

  return origins;
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string): number {
  if (!value || value.trim() === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return parsed;
}

function parseOptionalSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const jwtSecret = required("JWT_SECRET");

if (jwtSecret.length < 16) {
  throw new Error("JWT_SECRET must be at least 16 characters.");
}

export const env = {
  nodeEnv,
  port: parsePort(process.env.PORT),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN, nodeEnv),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || "7d",
  tripGenerationRateLimitMax: parsePositiveInteger(
    process.env.TRIP_GENERATION_RATE_LIMIT_MAX,
    15,
    "TRIP_GENERATION_RATE_LIMIT_MAX"
  ),
  tripGenerationRateLimitWindowMs: parsePositiveInteger(
    process.env.TRIP_GENERATION_RATE_LIMIT_WINDOW_MS,
    60_000,
    "TRIP_GENERATION_RATE_LIMIT_WINDOW_MS"
  ),
  openaiApiKey: parseOptionalSecret(process.env.OPENAI_API_KEY),
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  openaiTimeoutMs: parsePositiveInteger(process.env.OPENAI_TIMEOUT_MS, 11_000, "OPENAI_TIMEOUT_MS"),
  tripzyncApiKey: process.env.TRIPZYNC_API_KEY?.trim() || undefined,
} as const;
