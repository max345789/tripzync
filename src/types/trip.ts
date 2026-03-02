export const BUDGET_TIERS = ["low", "moderate", "luxury"] as const;

export type BudgetTier = (typeof BUDGET_TIERS)[number];

export type ActivityTime = "Morning" | "Afternoon" | "Evening";
export type TravelMode = "walk" | "transit" | "drive";

export type GenerateTripRequest = {
  destination: string;
  days: number;
  budget: BudgetTier;
  startCity?: string;
};

export type RegenerateTripRequest = {
  days?: number;
  budget?: BudgetTier;
};

export type UpdateTripRequest = {
  destination?: string;
  days?: number;
  budget?: BudgetTier;
  startCity?: string;
};

export type ListTripsQuery = {
  limit: number;
  offset: number;
  page: number;
};

export type ExploreQuery = {
  limit: number;
  q?: string;
};

export type ActivityDTO = {
  time: ActivityTime;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  durationMinutes: number;
  travelToNextMinutes?: number;
  travelToNextKm?: number;
  travelMode?: TravelMode;
};

export type ItineraryDayDTO = {
  dayNumber: number;
  activities: ActivityDTO[];
};

export type TripDTO = {
  id: string;
  destination: string;
  days: number;
  budget: BudgetTier;
  userId: string;
  startCity: string;
  startLatitude?: number;
  startLongitude?: number;
  createdAt: string;
  updatedAt: string;
  itinerary: ItineraryDayDTO[];
};

export type TripListResponse = {
  items: TripDTO[];
  total: number;
  limit: number;
  offset: number;
  page: number;
};

export type DeleteTripResponse = {
  id: string;
  deleted: true;
};

export type ExploreSpotDTO = {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  latitude: number;
  longitude: number;
  source: "trip_history" | "fallback";
};
