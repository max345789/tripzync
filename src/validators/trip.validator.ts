import { ParsedQs } from "qs";
import {
  BUDGET_TIERS,
  BudgetTier,
  ExploreQuery,
  GenerateTripRequest,
  ListTripsQuery,
  RegenerateTripRequest,
  UpdateTripRequest,
} from "../types/trip";
import { AppError } from "../utils/app-error";

const MIN_DAYS = 1;
const MAX_DAYS = 14;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_LIST_OFFSET = 0;
const MAX_DESTINATION_LENGTH = 120;
const DEFAULT_EXPLORE_LIMIT = 12;
const MAX_EXPLORE_LIMIT = 30;

const TRIP_ID_REGEX = /^c[a-z0-9]{24}$/;

const BUDGET_ALIAS: Record<string, BudgetTier> = {
  low: "low",
  budget: "low",
  moderate: "moderate",
  medium: "moderate",
  luxury: "luxury",
  premium: "luxury",
};

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

function assertAllowedQueryKeys(query: ParsedQs, allowedKeys: string[]): void {
  const invalidKey = Object.keys(query).find((key) => !allowedKeys.includes(key));
  if (invalidKey) {
    throw new AppError(400, "VALIDATION_ERROR", `Unsupported query parameter: ${invalidKey}.`);
  }
}

function parseBudget(raw: unknown): BudgetTier {
  if (typeof raw !== "string") {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Budget must be one of: ${BUDGET_TIERS.join(", ")} (aliases: budget, medium, premium).`
    );
  }

  const normalized = raw.trim().toLowerCase();
  const budget = BUDGET_ALIAS[normalized];

  if (!budget) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Budget must be one of: ${BUDGET_TIERS.join(", ")} (aliases: budget, medium, premium).`
    );
  }

  return budget;
}

function parseDays(raw: unknown, required = true): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    if (required) {
      throw new AppError(400, "VALIDATION_ERROR", "Days is required.");
    }

    return undefined;
  }

  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}.`
    );
  }

  if (raw < MIN_DAYS || raw > MAX_DAYS) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}.`
    );
  }

  return raw;
}

function parseDestination(raw: unknown, required = true): string | undefined {
  if (raw === undefined || raw === null || raw === "") {
    if (required) {
      throw new AppError(400, "VALIDATION_ERROR", "Destination is required.");
    }

    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Destination must be a string.");
  }

  const destination = raw.trim();
  if (!destination) {
    throw new AppError(400, "VALIDATION_ERROR", "Destination is required.");
  }

  if (destination.length > MAX_DESTINATION_LENGTH) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Destination must be <= ${MAX_DESTINATION_LENGTH} characters.`
    );
  }

  return destination;
}

function parsePositiveInteger(
  raw: string | ParsedQs | Array<string | ParsedQs> | undefined,
  field: string,
  fallback: number,
  maxValue: number
): number {
  if (raw === undefined) return fallback;
  if (Array.isArray(raw) || typeof raw !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a positive integer.`);
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a positive integer.`);
  }

  if (parsed > maxValue) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be <= ${maxValue}.`);
  }

  return parsed;
}

export function validateTripIdParam(rawId: unknown): string {
  if (typeof rawId !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Trip ID is required.");
  }

  const tripId = rawId.trim();
  if (!TRIP_ID_REGEX.test(tripId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Trip ID is invalid.");
  }

  return tripId;
}

export function validateGenerateTripRequest(payload: unknown): GenerateTripRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["destination", "days", "budget", "startCity"], "Request body");

  return {
    destination: parseDestination(body.destination, true) as string,
    days: parseDays(body.days, true) as number,
    budget: parseBudget(body.budget),
    startCity: parseDestination(body.startCity, false),
  };
}

export function validateRegenerateTripRequest(payload: unknown): RegenerateTripRequest {
  if (payload === undefined || payload === null) {
    return {};
  }

  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["days", "budget"], "Request body");

  return {
    days: parseDays(body.days, false),
    budget: body.budget === undefined ? undefined : parseBudget(body.budget),
  };
}

export function validateUpdateTripRequest(payload: unknown): UpdateTripRequest {
  const body = assertObject(payload, "Request body");
  assertAllowedKeys(body, ["destination", "days", "budget", "startCity"], "Request body");

  const destination = parseDestination(body.destination, false);
  const days = parseDays(body.days, false);
  const budget = body.budget === undefined ? undefined : parseBudget(body.budget);
  const startCity = parseDestination(body.startCity, false);

  if (destination === undefined && days === undefined && budget === undefined && startCity === undefined) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "At least one field is required: destination, days, budget, or startCity."
    );
  }

  return { destination, days, budget, startCity };
}

export function validateListTripsQuery(query: ParsedQs): ListTripsQuery {
  assertAllowedQueryKeys(query, ["limit", "offset", "page"]);
  const limit = parsePositiveInteger(query.limit, "limit", DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset =
    query.offset === undefined
      ? DEFAULT_LIST_OFFSET
      : parsePositiveInteger(query.offset, "offset", DEFAULT_LIST_OFFSET, 10_000);
  const page =
    query.page === undefined ? undefined : parsePositiveInteger(query.page, "page", 1, 10_000);

  if (page !== undefined && query.offset !== undefined) {
    throw new AppError(400, "VALIDATION_ERROR", "Use either page or offset, not both.");
  }

  if (page !== undefined && page < 1) {
    throw new AppError(400, "VALIDATION_ERROR", "page must be >= 1.");
  }

  const resolvedOffset = page !== undefined ? (page - 1) * limit : offset;
  const resolvedPage = page ?? Math.floor(resolvedOffset / limit) + 1;

  return { limit, offset: resolvedOffset, page: resolvedPage };
}

export function validateExploreQuery(query: ParsedQs): ExploreQuery {
  assertAllowedQueryKeys(query, ["limit", "q"]);
  const limit = parsePositiveInteger(query.limit, "limit", DEFAULT_EXPLORE_LIMIT, MAX_EXPLORE_LIMIT);

  let q: string | undefined;
  if (query.q !== undefined) {
    if (Array.isArray(query.q) || typeof query.q !== "string") {
      throw new AppError(400, "VALIDATION_ERROR", "q must be a string.");
    }

    const normalized = query.q.trim();
    if (normalized.length > 120) {
      throw new AppError(400, "VALIDATION_ERROR", "q must be <= 120 characters.");
    }

    q = normalized || undefined;
  }

  return { limit, q };
}
