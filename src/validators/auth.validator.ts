import {
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  SocialLoginRequest,
  SocialProvider,
} from "../types/auth";
import { AppError } from "../utils/app-error";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const NAME_MAX_LENGTH = 80;
const SOCIAL_ALLOWED_PROVIDERS: SocialProvider[] = ["google", "apple"];

function assertObject(payload: unknown, context: string): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError(400, "VALIDATION_ERROR", `${context} must be a JSON object.`);
  }

  return payload as Record<string, unknown>;
}

function assertAllowedKeys(
  body: Record<string, unknown>,
  allowedKeys: string[],
  context: string
): void {
  const invalidKey = Object.keys(body).find((key) => !allowedKeys.includes(key));
  if (invalidKey) {
    throw new AppError(400, "VALIDATION_ERROR", `${context} contains unsupported field: ${invalidKey}.`);
  }
}

function parseEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Email is required.");
  }

  const email = raw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new AppError(400, "VALIDATION_ERROR", "Email is invalid.");
  }

  return email;
}

function parsePassword(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Password is required.");
  }

  const password = raw.trim();
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`
    );
  }

  return password;
}

function parseOptionalName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Name must be a string.");
  }

  const name = raw.trim();
  if (name.length === 0) {
    return undefined;
  }

  if (name.length > NAME_MAX_LENGTH) {
    throw new AppError(400, "VALIDATION_ERROR", `Name must be <= ${NAME_MAX_LENGTH} characters.`);
  }

  return name;
}

export function validateRegisterRequest(payload: unknown): RegisterRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["email", "password", "name"], "Request body");

  return {
    email: parseEmail(body.email),
    password: parsePassword(body.password),
    name: parseOptionalName(body.name),
  };
}

export function validateLoginRequest(payload: unknown): LoginRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["email", "password"], "Request body");

  return {
    email: parseEmail(body.email),
    password: parsePassword(body.password),
  };
}

function parseProvider(raw: unknown): SocialProvider {
  if (typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "provider is required.");
  }
  const normalized = raw.trim().toLowerCase();
  if (!SOCIAL_ALLOWED_PROVIDERS.includes(normalized as SocialProvider)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `provider must be one of: ${SOCIAL_ALLOWED_PROVIDERS.join(", ")}.`
    );
  }
  return normalized as SocialProvider;
}

export function validateSocialLoginRequest(payload: unknown): SocialLoginRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["provider", "idToken", "email", "name"], "Request body");

  const provider = parseProvider(body.provider);

  if (typeof body.idToken !== "string" || !body.idToken.trim()) {
    throw new AppError(400, "VALIDATION_ERROR", "idToken is required.");
  }

  const email = body.email ? parseEmail(body.email) : undefined;
  const name = parseOptionalName(body.name);

  return {
    provider,
    idToken: body.idToken.trim(),
    email,
    name,
  };
}

export function validateRefreshTokenRequest(payload: unknown): RefreshTokenRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["refreshToken"], "Request body");

  if (typeof body.refreshToken !== "string" || !body.refreshToken.trim()) {
    throw new AppError(400, "VALIDATION_ERROR", "refreshToken is required.");
  }

  return {
    refreshToken: body.refreshToken.trim(),
  };
}
