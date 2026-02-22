export const BUDGET_TIERS = ["low", "moderate", "luxury"] as const;

export type BudgetTier = (typeof BUDGET_TIERS)[number];

export type ActivityTime = "Morning" | "Afternoon" | "Evening";

export type GenerateTripRequest = {
  destination: string;
  days: number;
  budget: BudgetTier;
};

export type RegenerateTripRequest = {
  days?: number;
  budget?: BudgetTier;
};

export type UpdateTripRequest = {
  destination?: string;
  days?: number;
  budget?: BudgetTier;
};

export type ListTripsQuery = {
  limit: number;
  offset: number;
};

export type ActivityDTO = {
  time: ActivityTime;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
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
  createdAt: string;
  updatedAt: string;
  itinerary: ItineraryDayDTO[];
};

export type TripListResponse = {
  items: TripDTO[];
  total: number;
  limit: number;
  offset: number;
};

export type DeleteTripResponse = {
  id: string;
  deleted: true;
};
