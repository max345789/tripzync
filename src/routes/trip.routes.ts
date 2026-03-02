import { Router } from "express";
import {
  deleteTripController,
  exploreController,
  generateTripController,
  getTripByIdController,
  listTripsController,
  regenerateTripController,
  updateTripController,
} from "../controllers/trip.controller";
import { env } from "../config/env";
import { requireAuth } from "../middlewares/auth.middleware";
import { createRateLimitMiddleware } from "../middlewares/rate-limit.middleware";

const router = Router();
const tripGenerationLimiter = createRateLimitMiddleware({
  windowMs: env.tripGenerationRateLimitWindowMs,
  maxRequests: env.tripGenerationRateLimitMax,
  message: "Too many trip generation requests. Please retry shortly.",
});

router.use(requireAuth);
router.post("/generate-trip", tripGenerationLimiter, generateTripController);
router.get("/explore", exploreController);
router.get("/trip/:id", getTripByIdController);
router.get("/trips", listTripsController);
router.patch("/trip/:id", updateTripController);
router.delete("/trip/:id", deleteTripController);
router.post("/trip/:id/regenerate", tripGenerationLimiter, regenerateTripController);

export default router;
