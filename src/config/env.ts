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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value || value.trim() === "") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;

  throw new Error("Invalid boolean value. Use true/false.");
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const jwtSecret = required("JWT_SECRET");

if (jwtSecret.length < 16) {
  throw new Error("JWT_SECRET must be at least 16 characters.");
}

const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim() || `${jwtSecret}-refresh`;
if (jwtRefreshSecret.length < 16) {
  throw new Error("JWT_REFRESH_SECRET must be at least 16 characters.");
}

const socialAuthEnabled = parseBoolean(process.env.SOCIAL_AUTH_ENABLED, false);
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
const appleClientId = process.env.APPLE_CLIENT_ID?.trim() || undefined;

if (nodeEnv === "production" && socialAuthEnabled) {
  if (!googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is required in production when SOCIAL_AUTH_ENABLED=true.");
  }

  if (!appleClientId) {
    throw new Error("APPLE_CLIENT_ID is required in production when SOCIAL_AUTH_ENABLED=true.");
  }
}

export const env = {
  nodeEnv,
  port: parsePort(process.env.PORT),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN, nodeEnv),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || "7d",
  jwtRefreshSecret,
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN?.trim() || "30d",
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
  tripGenerationTimeoutMs: parsePositiveInteger(
    process.env.TRIP_GENERATION_TIMEOUT_MS,
    9_000,
    "TRIP_GENERATION_TIMEOUT_MS"
  ),
  socialAuthEnabled,
  googleClientId,
  appleClientId,
  googleMapsApiKey: parseOptionalSecret(process.env.GOOGLE_MAPS_API_KEY),
  exploreLowCostMode: parseBoolean(process.env.EXPLORE_LOW_COST_MODE, true),
  exploreGoogleEnrichEnabled: parseBoolean(process.env.EXPLORE_GOOGLE_ENRICH_ENABLED, true),
  exploreGoogleMaxEnrichedPerRequest: parsePositiveInteger(
    process.env.EXPLORE_GOOGLE_MAX_ENRICHED_PER_REQUEST,
    2,
    "EXPLORE_GOOGLE_MAX_ENRICHED_PER_REQUEST"
  ),
  exploreGoogleDailyRequestCap: parsePositiveInteger(
    process.env.EXPLORE_GOOGLE_DAILY_REQUEST_CAP,
    500,
    "EXPLORE_GOOGLE_DAILY_REQUEST_CAP"
  ),
  exploreGoogleDistanceEnabled: parseBoolean(process.env.EXPLORE_GOOGLE_DISTANCE_ENABLED, false),
  openaiApiKey: parseOptionalSecret(process.env.OPENAI_API_KEY),
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  openaiTimeoutMs: parsePositiveInteger(process.env.OPENAI_TIMEOUT_MS, 11_000, "OPENAI_TIMEOUT_MS"),
  tripzyncApiKey: process.env.TRIPZYNC_API_KEY?.trim() || undefined,
  deployCommit:
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    undefined,
} as const;
