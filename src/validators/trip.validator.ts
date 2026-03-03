import { z } from "zod";
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

const BUDGET_ALIAS: Record<string, BudgetTier> = {
  low: "low",
  budget: "low",
  moderate: "moderate",
  medium: "moderate",
  luxury: "luxury",
  premium: "luxury",
};

const budgetSchema = z
  .string()
  .transform((val) => val.trim().toLowerCase())
  .refine((val) => Object.keys(BUDGET_ALIAS).includes(val), {
    message: `Budget must be one of: ${BUDGET_TIERS.join(", ")} (aliases: budget, medium, premium).`,
  })
  .transform((val) => BUDGET_ALIAS[val]);

const daysSchema = z.number().int().min(1).max(14);
const destinationSchema = z.string().trim().min(1, "Destination is required.").max(120);
const tripIdSchema = z.string().trim().regex(/^c[a-z0-9]{24}$/, "Trip ID is invalid.");

// Helper for parsing integers from query strings
const queryInt = (fallback: number, max: number, min = 0) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val === undefined ? fallback : Number(val)))
    .refine((val) => Number.isInteger(val) && val >= min && val <= max, {
      message: `Must be an integer between ${min} and ${max}.`,
    });

const generateTripSchema = z.object({
  destination: destinationSchema,
  days: daysSchema,
  budget: budgetSchema,
  startCity: destinationSchema.optional(),
}).strict();

const regenerateTripSchema = z.object({
  days: daysSchema.optional(),
  budget: budgetSchema.optional(),
}).strict();

const updateTripSchema = z.object({
  destination: destinationSchema.optional(),
  days: daysSchema.optional(),
  budget: budgetSchema.optional(),
  startCity: destinationSchema.optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  "At least one field is required: destination, days, budget, or startCity."
);

const listTripsQuerySchema = z.object({
  limit: queryInt(20, 100, 1),
  offset: queryInt(0, 10000),
  page: queryInt(1, 10000, 1).optional(),
}).strict().refine((data) => {
  if (data.page !== undefined && data.offset !== 0) { // Default offset is 0, so if both are set it's invalid unless offset wasn't provided, but our default sets it
    return false;
  }
  return true;
}, "Use either page or offset, not both.")
  .transform((data) => {
    const resolvedOffset = data.page !== undefined ? (data.page - 1) * data.limit : data.offset;
    const resolvedPage = data.page ?? Math.floor(resolvedOffset / data.limit) + 1;
    return { limit: data.limit, offset: resolvedOffset, page: resolvedPage };
  });

const exploreQuerySchema = z.object({
  limit: queryInt(12, 30, 1),
  q: z.string().trim().max(120, "q must be <= 120 characters.").optional().transform(v => v === "" ? undefined : v),
}).strict();

export function validateTripIdParam(rawId: unknown): string {
  return tripIdSchema.parse(rawId);
}

export function validateGenerateTripRequest(payload: unknown): GenerateTripRequest {
  return generateTripSchema.parse(payload);
}

export function validateRegenerateTripRequest(payload: unknown): RegenerateTripRequest {
  if (payload === undefined || payload === null) return {};
  return regenerateTripSchema.parse(payload);
}

export function validateUpdateTripRequest(payload: unknown): UpdateTripRequest {
  return updateTripSchema.parse(payload);
}

export function validateListTripsQuery(query: any): ListTripsQuery {
  const hasPage = Object.prototype.hasOwnProperty.call(query ?? {}, "page");
  const hasOffset = Object.prototype.hasOwnProperty.call(query ?? {}, "offset");
  if (hasPage && hasOffset) {
    throw new AppError(400, "VALIDATION_ERROR", "Use either page or offset, not both.");
  }
  return listTripsQuerySchema.parse(query);
}

export function validateExploreQuery(query: any): ExploreQuery {
  return exploreQuerySchema.parse(query);
}
