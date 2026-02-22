import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ActivityDTO,
  ActivityTime,
  BudgetTier,
  DeleteTripResponse,
  GenerateTripRequest,
  ListTripsQuery,
  RegenerateTripRequest,
  TripDTO,
  TripListResponse,
  UpdateTripRequest,
} from "../types/trip";
import { AppError } from "../utils/app-error";
import { generateAISuggestedItinerary } from "./ai-itinerary.service";

const ACTIVITY_ORDER: ActivityTime[] = ["Morning", "Afternoon", "Evening"];
const LOOKUP_TIMEOUT_MS = 5000;
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const HTTP_USER_AGENT = "Tripzync/1.0 (local-dev)";
const ANCHOR_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const PLACES_CACHE_TTL_MS = 1000 * 60 * 20;
const OVERPASS_LOOKUP_TIMEOUT_MS = 4500;
const NOMINATIM_LOOKUP_TIMEOUT_MS = 3000;

const PLACE_SEARCH_TERMS_BY_BUDGET: Record<BudgetTier, string[]> = {
  low: ["park", "museum", "market", "cafe", "viewpoint"],
  moderate: ["museum", "gallery", "restaurant", "cafe", "viewpoint", "theatre"],
  luxury: ["museum", "restaurant", "theatre", "viewpoint", "cafe", "gallery"],
};

type Anchor = {
  latitude: number;
  longitude: number;
  seed: number;
};

type NearbyPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
};

type NominatimResult = {
  lat: string;
  lon: string;
};

type NominatimPlaceResult = {
  place_id?: number;
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  type?: string;
  class?: string;
  category?: string;
  importance?: number;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const anchorCache = new Map<string, CacheEntry<Anchor>>();
const nearbyPlaceCache = new Map<string, CacheEntry<NearbyPlace[]>>();

const BUDGET_ACTIVITY_LIBRARY: Record<
  BudgetTier,
  Record<ActivityTime, Array<{ title: string; description: string }>>
> = {
  low: {
    Morning: [
      { title: "Local Walking Route", description: "Explore iconic streets and landmarks on foot." },
      { title: "Public Park Loop", description: "Visit scenic public spaces and neighborhood spots." },
      { title: "Street Culture Trail", description: "Experience local markets and architecture." },
    ],
    Afternoon: [
      { title: "Budget Food Crawl", description: "Try affordable local food highlights." },
      { title: "Community Museum Stop", description: "Visit value-focused cultural exhibits." },
      { title: "Transit-Friendly District Tour", description: "Cover top areas using public transport." },
    ],
    Evening: [
      { title: "Sunset Viewpoint", description: "Catch evening city views at no-cost lookouts." },
      { title: "Night Market Walk", description: "Explore night vendors and local life." },
      { title: "Riverside Stroll", description: "Wrap up the day with a relaxing waterfront walk." },
    ],
  },
  moderate: {
    Morning: [
      { title: "Landmark Highlights", description: "Visit must-see attractions with balanced pacing." },
      { title: "Curated City Walk", description: "Blend history, culture, and local favorites." },
      { title: "Scenic Neighborhood Circuit", description: "Discover character-rich districts and viewpoints." },
    ],
    Afternoon: [
      { title: "Museum and Cafe Pairing", description: "Combine a key museum with a quality cafe stop." },
      { title: "Signature Food Experience", description: "Enjoy a notable dining district and specialties." },
      { title: "Riverfront and Gallery Mix", description: "Balance leisure areas with cultural stops." },
    ],
    Evening: [
      { title: "Sunset and Skyline Route", description: "Experience golden-hour views and city lights." },
      { title: "Neighborhood Dining Plan", description: "Reserve time for a well-rated local dinner." },
      { title: "Evening Culture Walk", description: "Explore entertainment streets and relaxed nightlife." },
    ],
  },
  luxury: {
    Morning: [
      { title: "Private Landmark Circuit", description: "Premium pace through top signature attractions." },
      { title: "Exclusive Scenic Tour", description: "Enjoy curated routes with elevated comfort." },
      { title: "Luxury District Discovery", description: "Explore prestigious neighborhoods and design hubs." },
    ],
    Afternoon: [
      { title: "Fine Dining Preview", description: "Sample high-end culinary experiences." },
      { title: "Premium Museum Access", description: "Visit elite exhibits and architecturally notable venues." },
      { title: "Boutique Exploration", description: "Walk luxury retail and heritage streets." },
    ],
    Evening: [
      { title: "Rooftop Sunset Session", description: "Take in panoramic views from premium venues." },
      { title: "Signature Dinner Reservation", description: "End the day with acclaimed cuisine." },
      { title: "Chauffeured Night Route", description: "Experience the city after dark in comfort." },
    ],
  },
};

const BUDGET_RADIUS: Record<BudgetTier, number> = {
  low: 0.045,
  moderate: 0.03,
  luxury: 0.018,
};

const BUDGET_SEARCH_RADIUS_METERS: Record<BudgetTier, number> = {
  low: 4500,
  moderate: 3200,
  luxury: 2400,
};

const tripInclude = {
  itineraryDays: {
    orderBy: { dayNumber: "asc" as const },
    include: {
      activities: {
        orderBy: { sortOrder: "asc" as const },
      },
    },
  },
} satisfies Prisma.TripInclude;

function hashString(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeDestination(destination: string): string {
  return destination.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() >= cached.expiresAt) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function resolveAnchor(destination: string): { latitude: number; longitude: number; seed: number } {
  const normalized = normalizeDestination(destination);
  const seed = hashString(normalized);

  const latitude = ((seed % 1_200_000) / 10_000) - 60;
  const longitude = ((Math.floor(seed / 1_200_000) % 3_400_000) / 10_000) - 170;

  return {
    latitude: roundCoordinate(clamp(latitude, -70, 70)),
    longitude: roundCoordinate(clamp(longitude, -179, 179)),
    seed,
  };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  timeoutMs: number = LOOKUP_TIMEOUT_MS
): Promise<T | null> {
  if (typeof fetch !== "function") {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    } as never);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAnchorFromDestination(destination: string): Promise<Anchor> {
  const normalized = normalizeDestination(destination);
  const cachedAnchor = getCachedValue(anchorCache, normalized);
  if (cachedAnchor) {
    return cachedAnchor;
  }

  const fallback = resolveAnchor(destination);
  const query = new URLSearchParams({
    q: destination,
    format: "jsonv2",
    limit: "1",
  });

  const results = await fetchJsonWithTimeout<NominatimResult[]>(
    `${NOMINATIM_ENDPOINT}?${query.toString()}`,
    {
      headers: {
        "User-Agent": HTTP_USER_AGENT,
        Accept: "application/json",
      },
    }
  );

  const first = results?.[0];
  if (!first) {
    setCachedValue(anchorCache, normalized, fallback, ANCHOR_CACHE_TTL_MS);
    return fallback;
  }

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    setCachedValue(anchorCache, normalized, fallback, ANCHOR_CACHE_TTL_MS);
    return fallback;
  }

  const resolved = {
    latitude: roundCoordinate(clamp(latitude, -85, 85)),
    longitude: roundCoordinate(clamp(longitude, -179.9, 179.9)),
    seed: fallback.seed,
  };

  setCachedValue(anchorCache, normalized, resolved, ANCHOR_CACHE_TTL_MS);
  return resolved;
}

function derivePlaceCategory(tags?: Record<string, string>): string {
  if (!tags) {
    return "generic";
  }

  if (tags.amenity && ["restaurant", "cafe", "bar", "pub", "food_court", "marketplace"].includes(tags.amenity)) {
    return "food";
  }

  if (tags.leisure && ["park", "garden", "marina"].includes(tags.leisure)) {
    return "park";
  }

  if (tags.amenity && ["theatre", "cinema", "arts_centre"].includes(tags.amenity)) {
    return "entertainment";
  }

  if (tags.tourism && ["viewpoint", "attraction", "museum", "gallery", "zoo", "theme_park", "aquarium"].includes(tags.tourism)) {
    return "attraction";
  }

  if (tags.historic) {
    return "historic";
  }

  if (tags.shop) {
    return "shopping";
  }

  if (tags.natural) {
    return "nature";
  }

  return "generic";
}

function preferredForTime(category: string, time: ActivityTime): boolean {
  switch (time) {
    case "Morning":
      return ["attraction", "park", "historic", "nature"].includes(category);
    case "Afternoon":
      return ["attraction", "food", "shopping", "park"].includes(category);
    case "Evening":
      return ["food", "entertainment", "attraction"].includes(category);
    default:
      return false;
  }
}

function stablePlacesList(places: NearbyPlace[]): NearbyPlace[] {
  return places.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    if (byName !== 0) {
      return byName;
    }
    return a.id.localeCompare(b.id);
  });
}

function nominatimCategoryFromSearchTerm(term: string): string {
  const normalized = term.toLowerCase();

  if (["restaurant", "cafe", "market"].includes(normalized)) {
    return "food";
  }

  if (["park"].includes(normalized)) {
    return "park";
  }

  if (["theatre"].includes(normalized)) {
    return "entertainment";
  }

  if (["museum", "gallery", "viewpoint"].includes(normalized)) {
    return "attraction";
  }

  return "generic";
}

function placeNameFromNominatim(result: NominatimPlaceResult): string | null {
  const fromName = result.name?.trim();
  if (fromName) {
    return fromName;
  }

  const firstSegment = result.display_name?.split(",")[0]?.trim();
  if (!firstSegment) {
    return null;
  }

  return firstSegment;
}

function isLikelyRoadName(name: string): boolean {
  const normalized = name.trim().toLowerCase();

  return [
    " street",
    " road",
    " avenue",
    " boulevard",
    " highway",
    " route",
    " lane",
    " drive",
    " rue ",
  ].some((token) => normalized.includes(token));
}

function isNominatimPlaceRelevant(term: string, result: NominatimPlaceResult, name: string): boolean {
  const normalizedTerm = term.toLowerCase();
  const category = (result.category ?? result.class ?? "").toLowerCase();
  const type = (result.type ?? "").toLowerCase();

  if (!name || isLikelyRoadName(name)) {
    return false;
  }

  if (normalizedTerm === "park") {
    return (
      (category === "leisure" && ["park", "garden", "nature_reserve"].includes(type)) ||
      ["park", "garden"].includes(type)
    );
  }

  if (normalizedTerm === "museum") {
    return ["tourism", "amenity"].includes(category) && ["museum", "gallery", "attraction"].includes(type);
  }

  if (normalizedTerm === "gallery") {
    return ["tourism", "amenity"].includes(category) && ["gallery", "museum", "arts_centre"].includes(type);
  }

  if (normalizedTerm === "restaurant") {
    return category === "amenity" && ["restaurant", "food_court", "fast_food", "marketplace"].includes(type);
  }

  if (normalizedTerm === "cafe") {
    return category === "amenity" && ["cafe", "bar", "pub", "coffee_shop", "restaurant"].includes(type);
  }

  if (normalizedTerm === "theatre") {
    return category === "amenity" && ["theatre", "cinema", "arts_centre"].includes(type);
  }

  if (normalizedTerm === "viewpoint") {
    return category === "tourism" && ["viewpoint", "attraction"].includes(type);
  }

  if (normalizedTerm === "market") {
    return (
      ["shop", "amenity"].includes(category) ||
      ["marketplace", "retail", "supermarket"].includes(type)
    );
  }

  return true;
}

function destinationViewbox(anchor: Anchor, radiusMeters: number): string {
  const latDelta = radiusMeters / 111_000;
  const longitudeScale = Math.max(Math.cos((anchor.latitude * Math.PI) / 180), 0.2);
  const lonDelta = radiusMeters / (111_000 * longitudeScale);

  const left = roundCoordinate(clamp(anchor.longitude - lonDelta, -179.9, 179.9));
  const right = roundCoordinate(clamp(anchor.longitude + lonDelta, -179.9, 179.9));
  const top = roundCoordinate(clamp(anchor.latitude + latDelta, -85, 85));
  const bottom = roundCoordinate(clamp(anchor.latitude - latDelta, -85, 85));

  return `${left},${top},${right},${bottom}`;
}

function mergePlaces(primary: NearbyPlace[], secondary: NearbyPlace[]): NearbyPlace[] {
  const seen = new Set<string>();
  const merged: NearbyPlace[] = [];

  for (const place of [...primary, ...secondary]) {
    const key = place.name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(place);
  }

  return merged;
}

function mapOverpassPlaces(elements: OverpassElement[]): NearbyPlace[] {
  const uniqueByName = new Set<string>();
  const places: NearbyPlace[] = [];

  for (const element of elements) {
    const name = element.tags?.name?.trim();
    if (!name || name.length > 80) {
      continue;
    }

    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    const key = name.toLowerCase();
    if (uniqueByName.has(key)) {
      continue;
    }

    uniqueByName.add(key);
    places.push({
      id: `${element.type}-${element.id}`,
      name,
      latitude: roundCoordinate(clamp(latitude as number, -85, 85)),
      longitude: roundCoordinate(clamp(longitude as number, -179.9, 179.9)),
      category: derivePlaceCategory(element.tags),
    });
  }

  return places;
}

async function fetchNearbyPlacesFromOverpass(anchor: Anchor, budget: BudgetTier): Promise<NearbyPlace[]> {
  const radius = BUDGET_SEARCH_RADIUS_METERS[budget];
  const query = `
[out:json][timeout:6];
(
  node(around:${radius},${anchor.latitude},${anchor.longitude})["name"]["tourism"];
  node(around:${radius},${anchor.latitude},${anchor.longitude})["name"]["amenity"~"restaurant|cafe|bar|pub|marketplace|theatre|cinema|arts_centre|museum"];
  node(around:${radius},${anchor.latitude},${anchor.longitude})["name"]["leisure"~"park|garden"];
  node(around:${radius},${anchor.latitude},${anchor.longitude})["name"]["historic"];
);
out body 120;
`;

  const attemptPromises = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const response = await fetchJsonWithTimeout<OverpassResponse>(
      endpoint,
      {
        method: "POST",
        headers: {
          "User-Agent": HTTP_USER_AGENT,
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        body: query,
      },
      OVERPASS_LOOKUP_TIMEOUT_MS
    );

    return mapOverpassPlaces(response?.elements ?? []);
  });

  const settled = await Promise.allSettled(attemptPromises);
  const combined = settled
    .filter(
      (result): result is PromiseFulfilledResult<NearbyPlace[]> =>
        result.status === "fulfilled" && result.value.length > 0
    )
    .flatMap((result) => result.value);

  return combined;
}

async function fetchNearbyPlacesFromNominatim(anchor: Anchor, budget: BudgetTier): Promise<NearbyPlace[]> {
  const terms = PLACE_SEARCH_TERMS_BY_BUDGET[budget];
  const viewbox = destinationViewbox(anchor, BUDGET_SEARCH_RADIUS_METERS[budget]);

  const responses = await Promise.all(
    terms.map(async (term) => {
      const params = new URLSearchParams({
        q: term,
        format: "jsonv2",
        limit: "16",
        bounded: "1",
        viewbox,
      });

      const results = await fetchJsonWithTimeout<NominatimPlaceResult[]>(
        `${NOMINATIM_ENDPOINT}?${params.toString()}`,
        {
          headers: {
            "User-Agent": HTTP_USER_AGENT,
            Accept: "application/json",
          },
        },
        NOMINATIM_LOOKUP_TIMEOUT_MS
      );

      if (!results?.length) {
        return [];
      }

      return results
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .map((result, index) => {
        const name = placeNameFromNominatim(result);
        const latitude = Number(result.lat);
        const longitude = Number(result.lon);

        if (
          !name ||
          name.length > 80 ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !isNominatimPlaceRelevant(term, result, name)
        ) {
          return null;
        }

        return {
          id: `nom-${result.place_id ?? `${term}-${index}-${hashString(name)}`}`,
          name,
          latitude: roundCoordinate(clamp(latitude, -85, 85)),
          longitude: roundCoordinate(clamp(longitude, -179.9, 179.9)),
          category: nominatimCategoryFromSearchTerm(term),
        } satisfies NearbyPlace;
      });
    })
  );

  return responses.flat().filter((place): place is NearbyPlace => Boolean(place));
}

async function fetchNearbyPlaces(anchor: Anchor, destination: string, budget: BudgetTier): Promise<NearbyPlace[]> {
  const cacheKey = `${normalizeDestination(destination)}|${budget}`;
  const cached = getCachedValue(nearbyPlaceCache, cacheKey);
  if (cached) {
    return cached;
  }

  const primary = await fetchNearbyPlacesFromOverpass(anchor, budget);
  const secondary = primary.length >= 12 ? [] : await fetchNearbyPlacesFromNominatim(anchor, budget);
  const resolved = stablePlacesList(mergePlaces(primary, secondary));

  setCachedValue(nearbyPlaceCache, cacheKey, resolved, PLACES_CACHE_TTL_MS);
  return resolved;
}

function pickPlaceForSlot(
  places: NearbyPlace[],
  usedIds: Set<string>,
  time: ActivityTime,
  dayNumber: number,
  slotIndex: number,
  seed: number
): NearbyPlace | null {
  if (!places.length) {
    return null;
  }

  const preferred = places.filter((place) => preferredForTime(place.category, time) && !usedIds.has(place.id));
  const available = places.filter((place) => !usedIds.has(place.id));
  const pool = preferred.length ? preferred : available.length ? available : places;

  const index = (seed + dayNumber * 31 + slotIndex * 17 + time.length * 11) % pool.length;
  const selected = pool[index];
  usedIds.add(selected.id);
  return selected;
}

function activityCoordinates(
  anchor: { latitude: number; longitude: number; seed: number },
  dayNumber: number,
  slotIndex: number,
  budget: BudgetTier
): { latitude: number; longitude: number } {
  const radius = BUDGET_RADIUS[budget] * (1 + (dayNumber - 1) * 0.06);
  const angleDegrees = (anchor.seed % 360) + dayNumber * 53 + slotIndex * 121;
  const angleRadians = (angleDegrees * Math.PI) / 180;

  const latOffset = Math.cos(angleRadians) * radius;
  const longitudeScale = Math.max(Math.cos((anchor.latitude * Math.PI) / 180), 0.2);
  const lngOffset = (Math.sin(angleRadians) * radius) / longitudeScale;

  return {
    latitude: roundCoordinate(clamp(anchor.latitude + latOffset, -85, 85)),
    longitude: roundCoordinate(clamp(anchor.longitude + lngOffset, -179.9, 179.9)),
  };
}

function buildActivity(
  destination: string,
  dayNumber: number,
  time: ActivityTime,
  slotIndex: number,
  budget: BudgetTier,
  anchor: { latitude: number; longitude: number; seed: number },
  place: NearbyPlace | null
): ActivityDTO {
  const catalog = BUDGET_ACTIVITY_LIBRARY[budget][time];
  const template = catalog[(dayNumber + slotIndex) % catalog.length];
  const coords = place
    ? { latitude: place.latitude, longitude: place.longitude }
    : activityCoordinates(anchor, dayNumber, slotIndex, budget);

  return {
    time,
    title: place?.name ?? template.title,
    description: place
      ? `${template.description} Stop: ${place.name} in ${destination}. Day ${dayNumber}.`
      : `${template.description} Destination: ${destination}. Day ${dayNumber}.`,
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
}

function normalizeCardText(value: string | null | undefined, fallback: string, maxLength: number): string {
  const normalized = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\-\*"\s]+/, "")
    .replace(/[\s"]+$/, "")
    .trim();

  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function buildDeterministicItinerary(
  destination: string,
  days: number,
  budget: BudgetTier,
  anchor: Anchor,
  nearbyPlaces: NearbyPlace[]
) {
  const usedPlaceIds = new Set<string>();

  return Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1;

    return {
      dayNumber,
      activities: ACTIVITY_ORDER.map((time, slotIndex) => {
        const place = pickPlaceForSlot(nearbyPlaces, usedPlaceIds, time, dayNumber, slotIndex, anchor.seed);
        return buildActivity(destination, dayNumber, time, slotIndex, budget, anchor, place);
      }),
    };
  });
}

async function buildAIEnhancedItinerary(
  destination: string,
  days: number,
  budget: BudgetTier,
  anchor: Anchor,
  nearbyPlaces: NearbyPlace[]
) {
  const aiSuggestion = await generateAISuggestedItinerary(destination, days, budget, nearbyPlaces);
  if (!aiSuggestion) {
    return null;
  }

  const placeById = new Map(nearbyPlaces.map((place) => [place.id, place]));
  const suggestionsByDay = new Map(aiSuggestion.days.map((day) => [day.dayNumber, day]));
  const usedPlaceIds = new Set<string>();

  return Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1;
    const daySuggestion = suggestionsByDay.get(dayNumber);
    const suggestionByTime = new Map(daySuggestion?.activities.map((activity) => [activity.time, activity]));

    return {
      dayNumber,
      activities: ACTIVITY_ORDER.map((time, slotIndex) => {
        const slotSuggestion = suggestionByTime.get(time);
        const suggestedPlace =
          slotSuggestion?.placeId && !usedPlaceIds.has(slotSuggestion.placeId)
            ? placeById.get(slotSuggestion.placeId) ?? null
            : null;

        const place =
          suggestedPlace ??
          pickPlaceForSlot(nearbyPlaces, usedPlaceIds, time, dayNumber, slotIndex, anchor.seed);

        if (place) {
          usedPlaceIds.add(place.id);
        }

        const fallbackActivity = buildActivity(destination, dayNumber, time, slotIndex, budget, anchor, place);
        const title = normalizeCardText(slotSuggestion?.title, fallbackActivity.title, 84);
        const description = normalizeCardText(slotSuggestion?.description, fallbackActivity.description, 220);
        const hiddenGemPrefix = slotSuggestion?.hiddenGem ? "Hidden gem: " : "";

        return {
          ...fallbackActivity,
          title,
          description: normalizeCardText(
            hiddenGemPrefix ? `${hiddenGemPrefix}${description}` : description,
            fallbackActivity.description,
            220
          ),
        };
      }),
    };
  });
}

async function buildItinerary(destination: string, days: number, budget: BudgetTier) {
  const anchor = await resolveAnchorFromDestination(destination);
  const nearbyPlaces = await fetchNearbyPlaces(anchor, destination, budget);

  const aiItinerary = await buildAIEnhancedItinerary(destination, days, budget, anchor, nearbyPlaces);
  if (aiItinerary) {
    return aiItinerary;
  }

  return buildDeterministicItinerary(destination, days, budget, anchor, nearbyPlaces);
}

function mapTripResponse(trip: Prisma.TripGetPayload<{ include: typeof tripInclude }>): TripDTO {
  return {
    id: trip.id,
    destination: trip.destination,
    days: trip.days,
    budget: trip.budget as BudgetTier,
    userId: trip.userId,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    itinerary: trip.itineraryDays.map((day) => ({
      dayNumber: day.dayNumber,
      activities: day.activities.map((activity) => ({
        time: activity.time as ActivityTime,
        title: activity.title,
        description: activity.description,
        latitude: activity.latitude,
        longitude: activity.longitude,
      })),
    })),
  };
}

class TripService {
  async generateTrip(input: GenerateTripRequest, userId: string): Promise<TripDTO> {
    const itinerary = await buildItinerary(input.destination, input.days, input.budget);

    const createdTrip = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Authenticated user does not exist.");
      }

      const trip = await tx.trip.create({
        data: {
          destination: input.destination,
          days: input.days,
          budget: input.budget,
          userId,
          itineraryDays: {
            create: itinerary.map((day) => ({
              dayNumber: day.dayNumber,
              activities: {
                create: day.activities.map((activity, index) => ({
                  time: activity.time,
                  title: activity.title,
                  description: activity.description,
                  latitude: activity.latitude,
                  longitude: activity.longitude,
                  sortOrder: index,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });

      return tx.trip.findUniqueOrThrow({
        where: { id: trip.id },
        include: tripInclude,
      });
    });

    return mapTripResponse(createdTrip);
  }

  async getTripById(tripId: string, userId: string): Promise<TripDTO> {
    const trip = await prisma.trip.findFirst({
      where: {
        id: tripId,
        userId,
      },
      include: tripInclude,
    });

    if (!trip) {
      throw new AppError(404, "NOT_FOUND", "Trip not found.");
    }

    return mapTripResponse(trip);
  }

  async listTrips(query: ListTripsQuery, userId: string): Promise<TripListResponse> {
    const where: Prisma.TripWhereInput = { userId };

    const [total, trips] = await prisma.$transaction([
      prisma.trip.count({ where }),
      prisma.trip.findMany({
        where,
        include: tripInclude,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
    ]);

    return {
      items: trips.map(mapTripResponse),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async updateTrip(tripId: string, payload: UpdateTripRequest, userId: string): Promise<TripDTO> {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.trip.findFirst({
        where: {
          id: tripId,
          userId,
        },
        select: {
          id: true,
          destination: true,
          days: true,
          budget: true,
        },
      });

      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Trip not found.");
      }

      const destination = payload.destination ?? existing.destination;
      const days = payload.days ?? existing.days;
      const budget = payload.budget ?? (existing.budget as BudgetTier);
      const itinerary = await buildItinerary(destination, days, budget);

      await tx.itineraryDay.deleteMany({
        where: { tripId: existing.id },
      });

      return tx.trip.update({
        where: { id: existing.id },
        data: {
          destination,
          days,
          budget,
          itineraryDays: {
            create: itinerary.map((day) => ({
              dayNumber: day.dayNumber,
              activities: {
                create: day.activities.map((activity, index) => ({
                  time: activity.time,
                  title: activity.title,
                  description: activity.description,
                  latitude: activity.latitude,
                  longitude: activity.longitude,
                  sortOrder: index,
                })),
              },
            })),
          },
        },
        include: tripInclude,
      });
    });

    return mapTripResponse(result);
  }

  async deleteTripById(tripId: string, userId: string): Promise<DeleteTripResponse> {
    const deleted = await prisma.trip.deleteMany({
      where: {
        id: tripId,
        userId,
      },
    });

    if (deleted.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Trip not found.");
    }

    return {
      id: tripId,
      deleted: true,
    };
  }

  async regenerateTrip(tripId: string, payload: RegenerateTripRequest, userId: string): Promise<TripDTO> {
    const existing = await prisma.trip.findFirst({
      where: {
        id: tripId,
        userId,
      },
      select: {
        id: true,
        destination: true,
        days: true,
        budget: true,
      },
    });

    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Trip not found.");
    }

    const days = payload.days ?? existing.days;
    const budget = payload.budget ?? (existing.budget as BudgetTier);
    const itinerary = await buildItinerary(existing.destination, days, budget);

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.itineraryDay.deleteMany({ where: { tripId: existing.id } });

        return tx.trip.update({
          where: { id: existing.id },
          data: {
            days,
            budget,
            itineraryDays: {
              create: itinerary.map((day) => ({
                dayNumber: day.dayNumber,
                activities: {
                  create: day.activities.map((activity, index) => ({
                    time: activity.time,
                    title: activity.title,
                    description: activity.description,
                    latitude: activity.latitude,
                    longitude: activity.longitude,
                    sortOrder: index,
                  })),
                },
              })),
            },
          },
          include: tripInclude,
        });
      },
      {
        maxWait: 10_000,
        timeout: 20_000,
      }
    );

    return mapTripResponse(result);
  }
}

export const tripService = new TripService();
