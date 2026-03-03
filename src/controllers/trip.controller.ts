import { Request, Response } from "express";
import { sendSuccess } from "../utils/api-response";
import { asyncHandler } from "../utils/async-handler";
import {
  validateExploreQuery,
  validateGenerateTripRequest,
  validateListTripsQuery,
  validateRegenerateTripRequest,
  validateTripIdParam,
  validateUpdateTripRequest,
} from "../validators/trip.validator";
import { tripService } from "../services/trip.service";
import { AppError } from "../utils/app-error";

function authUserId(req: Request): string {
  if (!req.auth?.userId) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return req.auth.userId;
}

export const generateTripController = asyncHandler(async (req: Request, res: Response) => {
  const payload = validateGenerateTripRequest(req.body);
  const trip = req.auth?.userId
    ? await tripService.generateTrip(payload, req.auth.userId)
    : await tripService.previewTrip(payload);

  return sendSuccess(res, trip, req.auth?.userId ? 201 : 200);
});

export const getTripByIdController = asyncHandler(async (req: Request, res: Response) => {
  const tripId = validateTripIdParam(req.params.id);
  const trip = await tripService.getTripById(tripId, authUserId(req));

  return sendSuccess(res, trip);
});

export const listTripsController = asyncHandler(async (req: Request, res: Response) => {
  const query = validateListTripsQuery(req.query);
  const result = await tripService.listTrips(query, authUserId(req));

  return sendSuccess(res, result.items, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    page: result.page,
  });
});

export const exploreController = asyncHandler(async (req: Request, res: Response) => {
  const query = validateExploreQuery(req.query);
  const spots = await tripService.listExploreSpots(query, authUserId(req));

  return sendSuccess(res, spots);
});

export const deleteTripController = asyncHandler(async (req: Request, res: Response) => {
  const tripId = validateTripIdParam(req.params.id);
  const result = await tripService.deleteTripById(tripId, authUserId(req));

  return sendSuccess(res, result);
});

export const regenerateTripController = asyncHandler(async (req: Request, res: Response) => {
  const tripId = validateTripIdParam(req.params.id);
  const payload = validateRegenerateTripRequest(req.body);
  const trip = await tripService.regenerateTrip(tripId, payload, authUserId(req));

  return sendSuccess(res, trip);
});

export const updateTripController = asyncHandler(async (req: Request, res: Response) => {
  const tripId = validateTripIdParam(req.params.id);
  const payload = validateUpdateTripRequest(req.body);
  const trip = await tripService.updateTrip(tripId, payload, authUserId(req));

  return sendSuccess(res, trip);
});
