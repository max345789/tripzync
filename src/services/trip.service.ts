import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ActivityDTO,
  ActivityTime,
  BudgetTier,
  DeleteTripResponse,
  ExploreQuery,
  ExploreSpotDTO,
  GenerateTripRequest,
  ListTripsQuery,
  RegenerateTripRequest,
  TripDTO,
  TripPreviewDTO,
  TripListResponse,
  TravelMode,
  UpdateTripRequest,
} from "../types/trip";
import { env } from "../config/env";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
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
const DB_TRANSACTION_MAX_WAIT_MS = 10_000;
const DB_TRANSACTION_TIMEOUT_MS = 20_000;
const GENERATION_HARD_TIMEOUT_MS = 8_500;
const AI_PHASE_TIMEOUT_MS = 3_000;
const GOOGLE_API_LOOKUP_TIMEOUT_MS = 2_800;
const GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GOOGLE_PLACES_NEARBY_SEARCH_ENDPOINT = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const GOOGLE_DISTANCE_MATRIX_ENDPOINT = "https://maps.googleapis.com/maps/api/distancematrix/json";
const GOOGLE_PLACE_PHOTO_ENDPOINT = "https://maps.googleapis.com/maps/api/place/photo";
const WIKIMEDIA_API_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const DISTANCE_MATRIX_DESTINATION_LIMIT = 25;
const EXPLORE_ENRICH_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const GOOGLE_PHOTO_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const WIKIMEDIA_LOOKUP_TIMEOUT_MS = 2_200;
const WIKIMEDIA_PHOTO_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

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

type GeneratedActivity = ActivityDTO & {
  durationMinutes: number;
  travelToNextMinutes?: number;
  travelToNextKm?: number;
  travelMode?: TravelMode;
};

type GeneratedDay = {
  dayNumber: number;
  activities: GeneratedActivity[];
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

type GooglePlacesTextSearchResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    name?: string;
    formatted_address?: string;
    place_id?: string;
    photos?: Array<{
      photo_reference?: string;
    }>;
  }>;
};

type GooglePlacesNearbySearchResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    name?: string;
    vicinity?: string;
    place_id?: string;
    photos?: Array<{
      photo_reference?: string;
    }>;
  }>;
};

type GoogleDistanceMatrixResponse = {
  status?: string;
  error_message?: string;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: {
        value?: number;
      };
    }>;
  }>;
};

type WikimediaSearchResponse = {
  query?: {
    pages?: Array<{
      title?: string;
      thumbnail?: {
        source?: string;
      };
    }>;
  };
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ExploreSpotSeed = ExploreSpotDTO & {
  originLatitude?: number;
  originLongitude?: number;
};

const anchorCache = new Map<string, CacheEntry<Anchor>>();
const nearbyPlaceCache = new Map<string, CacheEntry<NearbyPlace[]>>();
const exploreEnrichmentCache = new Map<
  string,
  CacheEntry<{ title: string; photoUrl?: string; address?: string; placeId?: string }>
>();
const googlePhotoCache = new Map<string, CacheEntry<string>>();
const wikimediaPhotoCache = new Map<string, CacheEntry<{ url?: string }>>();

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
): GeneratedActivity {
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
    durationMinutes: 90,
  };
}

function haversineKm(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateTravel(distanceKm: number, budget: BudgetTier): { minutes: number; mode: TravelMode } {
  if (distanceKm < 1.2) {
    return { minutes: Math.max(8, Math.round(distanceKm * 14)), mode: "walk" };
  }

  if (budget === "luxury") {
    return { minutes: Math.max(10, Math.min(70, Math.round((distanceKm / 26) * 60))), mode: "drive" };
  }

  return { minutes: Math.max(12, Math.min(85, Math.round((distanceKm / 20) * 60))), mode: "transit" };
}

function baseDurationMinutes(budget: BudgetTier, time: ActivityTime): number {
  if (budget === "low") {
    if (time === "Morning") return 95;
    if (time === "Afternoon") return 110;
    return 100;
  }

  if (budget === "luxury") {
    if (time === "Morning") return 130;
    if (time === "Afternoon") return 155;
    return 125;
  }

  if (time === "Morning") return 110;
  if (time === "Afternoon") return 135;
  return 115;
}

function enrichDayActivitiesWithTiming(
  activities: GeneratedActivity[],
  budget: BudgetTier
): GeneratedActivity[] {
  return activities.map((activity, index) => {
    const next = activities[index + 1];
    const enriched: GeneratedActivity = {
      ...activity,
      durationMinutes: baseDurationMinutes(budget, activity.time),
    };

    if (!next) {
      return enriched;
    }

    const distanceKm = haversineKm(activity.latitude, activity.longitude, next.latitude, next.longitude);
    const travel = estimateTravel(distanceKm, budget);

    return {
      ...enriched,
      travelToNextMinutes: travel.minutes,
      travelToNextKm: Math.round(distanceKm * 10) / 10,
      travelMode: travel.mode,
    };
  });
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
): GeneratedDay[] {
  const usedPlaceIds = new Set<string>();

  return Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1;
    const baseActivities = ACTIVITY_ORDER.map((time, slotIndex) => {
      const place = pickPlaceForSlot(nearbyPlaces, usedPlaceIds, time, dayNumber, slotIndex, anchor.seed);
      return buildActivity(destination, dayNumber, time, slotIndex, budget, anchor, place);
    });

    return {
      dayNumber,
      activities: enrichDayActivitiesWithTiming(baseActivities, budget),
    };
  });
}

async function buildAIEnhancedItinerary(
  destination: string,
  days: number,
  budget: BudgetTier,
  anchor: Anchor,
  nearbyPlaces: NearbyPlace[]
): Promise<GeneratedDay[] | null> {
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
    const baseActivities = ACTIVITY_ORDER.map((time, slotIndex) => {
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
    });

    return {
      dayNumber,
      activities: enrichDayActivitiesWithTiming(baseActivities, budget),
    };
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
  });
}

async function buildItinerary(destination: string, days: number, budget: BudgetTier) {
  const start = Date.now();
  const hardLimit = Math.max(4_000, env.tripGenerationTimeoutMs ?? GENERATION_HARD_TIMEOUT_MS);
  const fallbackAnchor = resolveAnchor(destination);
  const fallbackItinerary = buildDeterministicItinerary(destination, days, budget, fallbackAnchor, []);
  const hardTimeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), hardLimit);
  });

  const generationPromise = (async () => {
    const anchor = (await withTimeout(resolveAnchorFromDestination(destination), 2_500)) ?? fallbackAnchor;
    const nearbyPlaces = (await withTimeout(fetchNearbyPlaces(anchor, destination, budget), 3_500)) ?? [];
    const aiItinerary = await withTimeout(
      buildAIEnhancedItinerary(destination, days, budget, anchor, nearbyPlaces),
      AI_PHASE_TIMEOUT_MS
    );

    return {
      anchor,
      itinerary: aiItinerary ?? buildDeterministicItinerary(destination, days, budget, anchor, nearbyPlaces),
    };
  })();

  const result = await Promise.race([generationPromise, hardTimeoutPromise]);
  if (!result) {
    logger.warn("TRIP_GENERATION_TIMEOUT_FALLBACK", {
      destination,
      days,
      budget,
      elapsedMs: Date.now() - start,
    });
    return {
      anchor: fallbackAnchor,
      itinerary: fallbackItinerary,
      fallbackUsed: true,
    };
  }

  logger.info("TRIP_GENERATION_COMPLETED", {
    destination,
    days,
    budget,
    elapsedMs: Date.now() - start,
  });

  return {
    anchor: result.anchor,
    itinerary: result.itinerary,
    fallbackUsed: false,
  };
}

function mapTripResponse(trip: Prisma.TripGetPayload<{ include: typeof tripInclude }>): TripDTO {
  return {
    id: trip.id,
    destination: trip.destination,
    days: trip.days,
    budget: trip.budget as BudgetTier,
    userId: trip.userId,
    startCity: trip.startCity,
    startLatitude: trip.startLatitude ?? undefined,
    startLongitude: trip.startLongitude ?? undefined,
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
        durationMinutes: activity.durationMinutes,
        travelToNextMinutes: activity.travelToNextMinutes ?? undefined,
        travelToNextKm: activity.travelToNextKm ?? undefined,
        travelMode: (activity.travelMode as TravelMode | null) ?? undefined,
      })),
    })),
  };
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0 || chunkSize <= 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function fallbackPlacePhotoUrl(title: string, location: string): string {
  const seed = encodeURIComponent(`${title}-${location}`.trim().toLowerCase().replace(/\s+/g, "-"));
  return `https://picsum.photos/seed/${seed}/1200/800`;
}

async function resolveWikimediaPhotoUrl(title: string, location: string): Promise<string | undefined> {
  const cacheKey = `${title.toLowerCase()}|${location.toLowerCase()}`;
  const cached = getCachedValue(wikimediaPhotoCache, cacheKey);
  if (cached) {
    return cached.url;
  }

  const queries = [`${title} ${location}`, title, `${location} landmark`];

  for (const candidate of queries) {
    const query = candidate.trim();
    if (!query) {
      continue;
    }

    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrlimit: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "1200",
      format: "json",
      formatversion: "2",
    });

    const response = await fetchJsonWithTimeout<WikimediaSearchResponse>(
      `${WIKIMEDIA_API_ENDPOINT}?${params.toString()}`,
      {
        headers: {
          "User-Agent": HTTP_USER_AGENT,
          Accept: "application/json",
        },
      },
      WIKIMEDIA_LOOKUP_TIMEOUT_MS
    );

    const photoUrl = response?.query?.pages?.[0]?.thumbnail?.source?.trim();
    if (photoUrl) {
      setCachedValue(wikimediaPhotoCache, cacheKey, { url: photoUrl }, WIKIMEDIA_PHOTO_CACHE_TTL_MS);
      return photoUrl;
    }
  }

  setCachedValue(wikimediaPhotoCache, cacheKey, { url: undefined }, WIKIMEDIA_PHOTO_CACHE_TTL_MS);
  return undefined;
}

async function resolveBestFallbackPhotoUrl(title: string, location: string): Promise<string> {
  const wikiPhotoUrl = await resolveWikimediaPhotoUrl(title, location);
  return wikiPhotoUrl ?? fallbackPlacePhotoUrl(title, location);
}

async function resolveGooglePhotoRedirectUrl(photoReference: string): Promise<string | undefined> {
  if (!env.googleMapsApiKey || !photoReference.trim()) {
    return undefined;
  }

  const cached = getCachedValue(googlePhotoCache, photoReference);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    maxwidth: "1200",
    photo_reference: photoReference,
    key: env.googleMapsApiKey,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_API_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`${GOOGLE_PLACE_PHOTO_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": HTTP_USER_AGENT,
      },
    });

    const redirectedUrl = response.headers.get("location")?.trim();
    if (redirectedUrl) {
      setCachedValue(googlePhotoCache, photoReference, redirectedUrl, GOOGLE_PHOTO_CACHE_TTL_MS);
      return redirectedUrl;
    }

    if (response.ok && response.url) {
      setCachedValue(googlePhotoCache, photoReference, response.url, GOOGLE_PHOTO_CACHE_TTL_MS);
      return response.url;
    }
  } catch {
    // best effort
  } finally {
    clearTimeout(timeout);
  }

  return undefined;
}

async function enrichSpotFromGooglePlaces(spot: ExploreSpotSeed): Promise<ExploreSpotSeed> {
  if (!env.googleMapsApiKey) {
    const fallbackPhotoUrl =
      spot.photoUrl?.trim() || (await resolveBestFallbackPhotoUrl(spot.title, spot.location));

    return {
      ...spot,
      photoUrl: fallbackPhotoUrl,
    };
  }

  const cacheKey = `${spot.title.toLowerCase()}|${spot.location.toLowerCase()}`;
  const cached = getCachedValue(exploreEnrichmentCache, cacheKey);
  if (cached) {
    const fallbackPhotoUrl =
      spot.photoUrl?.trim() || (await resolveBestFallbackPhotoUrl(cached.title, spot.location));

    return {
      ...spot,
      title: cached.title,
      photoUrl: cached.photoUrl ?? fallbackPhotoUrl,
      address: cached.address,
      placeId: cached.placeId,
    };
  }

  const nearbyParams = new URLSearchParams({
    location: `${spot.latitude},${spot.longitude}`,
    radius: "1800",
    key: env.googleMapsApiKey,
  });
  if (spot.title.trim().length >= 3) {
    nearbyParams.set("keyword", spot.title.trim());
  }

  let nearbyResponse = await fetchJsonWithTimeout<GooglePlacesNearbySearchResponse>(
    `${GOOGLE_PLACES_NEARBY_SEARCH_ENDPOINT}?${nearbyParams.toString()}`,
    {
      headers: {
        "User-Agent": HTTP_USER_AGENT,
        Accept: "application/json",
      },
    },
    GOOGLE_API_LOOKUP_TIMEOUT_MS
  );

  let nearbyMatch = nearbyResponse?.results?.[0];
  if (!nearbyMatch && nearbyParams.has("keyword")) {
    nearbyParams.delete("keyword");
    nearbyResponse = await fetchJsonWithTimeout<GooglePlacesNearbySearchResponse>(
      `${GOOGLE_PLACES_NEARBY_SEARCH_ENDPOINT}?${nearbyParams.toString()}`,
      {
        headers: {
          "User-Agent": HTTP_USER_AGENT,
          Accept: "application/json",
        },
      },
      GOOGLE_API_LOOKUP_TIMEOUT_MS
    );
    nearbyMatch = nearbyResponse?.results?.[0];
  }

  if (nearbyMatch?.name?.trim()) {
    const matchedTitle = toTitleCase(nearbyMatch.name);
    const photoReference =
      typeof nearbyMatch.photos?.[0]?.photo_reference === "string"
        ? nearbyMatch.photos[0].photo_reference.trim()
        : "";
    const googlePhotoUrl = photoReference ? await resolveGooglePhotoRedirectUrl(photoReference) : undefined;
    const fallbackPhotoUrl = spot.photoUrl?.trim() || (await resolveBestFallbackPhotoUrl(matchedTitle, spot.location));
    const photoUrl = googlePhotoUrl ?? fallbackPhotoUrl;
    const address = nearbyMatch.vicinity?.trim() || undefined;
    const placeId = nearbyMatch.place_id?.trim() || undefined;

    setCachedValue(
      exploreEnrichmentCache,
      cacheKey,
      {
        title: matchedTitle,
        photoUrl,
        address,
        placeId,
      },
      EXPLORE_ENRICH_CACHE_TTL_MS
    );

    return {
      ...spot,
      title: matchedTitle,
      photoUrl,
      address,
      placeId,
    };
  }

  const params = new URLSearchParams({
    query: `${spot.title} ${spot.location}`,
    location: `${spot.latitude},${spot.longitude}`,
    radius: "6000",
    key: env.googleMapsApiKey,
  });

  const response = await fetchJsonWithTimeout<GooglePlacesTextSearchResponse>(
    `${GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT}?${params.toString()}`,
    {
      headers: {
        "User-Agent": HTTP_USER_AGENT,
        Accept: "application/json",
      },
    },
    GOOGLE_API_LOOKUP_TIMEOUT_MS
  );

  const match = response?.results?.[0];
  const matchedTitle = typeof match?.name === "string" && match.name.trim() ? toTitleCase(match.name) : spot.title;
  const address = typeof match?.formatted_address === "string" ? match.formatted_address.trim() || undefined : undefined;
  const placeId = typeof match?.place_id === "string" ? match.place_id.trim() || undefined : undefined;
  const photoReference =
    typeof match?.photos?.[0]?.photo_reference === "string" ? match.photos[0].photo_reference.trim() : "";
  const googlePhotoUrl = photoReference ? await resolveGooglePhotoRedirectUrl(photoReference) : undefined;
  const fallbackPhotoUrl =
    spot.photoUrl?.trim() || (await resolveBestFallbackPhotoUrl(matchedTitle, spot.location));
  const photoUrl = googlePhotoUrl ?? fallbackPhotoUrl;

  setCachedValue(
    exploreEnrichmentCache,
    cacheKey,
    {
      title: matchedTitle,
      photoUrl,
      address,
      placeId,
    },
    EXPLORE_ENRICH_CACHE_TTL_MS
  );

  return {
    ...spot,
    title: matchedTitle,
    photoUrl,
    address,
    placeId,
  };
}

async function applyGoogleDistanceMatrix(spots: ExploreSpotSeed[]): Promise<ExploreSpotSeed[]> {
  const withFallback = spots.map((spot) => {
    if (
      Number.isFinite(spot.originLatitude) &&
      Number.isFinite(spot.originLongitude)
    ) {
      return {
        ...spot,
        distanceKm: roundOneDecimal(
          haversineKm(
            spot.originLatitude as number,
            spot.originLongitude as number,
            spot.latitude,
            spot.longitude
          )
        ),
      };
    }

    return spot;
  });

  if (!env.googleMapsApiKey) {
    return withFallback;
  }

  const groupedByOrigin = new Map<string, Array<{ index: number; spot: ExploreSpotSeed }>>();
  withFallback.forEach((spot, index) => {
    if (!Number.isFinite(spot.originLatitude) || !Number.isFinite(spot.originLongitude)) {
      return;
    }

    const key = `${(spot.originLatitude as number).toFixed(6)},${(spot.originLongitude as number).toFixed(6)}`;
    const existing = groupedByOrigin.get(key) ?? [];
    existing.push({ index, spot });
    groupedByOrigin.set(key, existing);
  });

  for (const [originKey, entries] of groupedByOrigin.entries()) {
    const chunks = chunkArray(entries, DISTANCE_MATRIX_DESTINATION_LIMIT);

    for (const chunk of chunks) {
      const destinations = chunk
        .map(({ spot }) => `${spot.latitude},${spot.longitude}`)
        .join("|");

      const params = new URLSearchParams({
        origins: originKey,
        destinations,
        mode: "driving",
        units: "metric",
        key: env.googleMapsApiKey,
      });

      const response = await fetchJsonWithTimeout<GoogleDistanceMatrixResponse>(
        `${GOOGLE_DISTANCE_MATRIX_ENDPOINT}?${params.toString()}`,
        {
          headers: {
            "User-Agent": HTTP_USER_AGENT,
            Accept: "application/json",
          },
        },
        GOOGLE_API_LOOKUP_TIMEOUT_MS
      );

      const elements = response?.rows?.[0]?.elements;
      if (!elements || !Array.isArray(elements)) {
        continue;
      }

      elements.forEach((element, index) => {
        if (!element || element.status !== "OK") {
          return;
        }

        const meters = element.distance?.value;
        if (!Number.isFinite(meters)) {
          return;
        }

        const target = chunk[index];
        if (!target) {
          return;
        }

        withFallback[target.index] = {
          ...withFallback[target.index],
          distanceKm: roundOneDecimal((meters as number) / 1000),
        };
      });
    }
  }

  return withFallback;
}

const EXPLORE_FALLBACKS: Array<{ title: string; subtitle: string; location: string }> = [
  { title: "Hidden City Walk", subtitle: "Hidden Gems", location: "Old Town" },
  { title: "Local Flavor Route", subtitle: "Food", location: "Market District" },
  { title: "Sunset Viewpoint", subtitle: "Nature", location: "Hilltop" },
  { title: "Arts and Stories", subtitle: "Culture", location: "Museum Quarter" },
  { title: "Night Lights Loop", subtitle: "Evening", location: "City Center" },
];

class TripService {
  async previewTrip(input: GenerateTripRequest): Promise<TripPreviewDTO> {
    const startTime = Date.now();
    const startCity = (input.startCity ?? input.destination).trim();
    const { itinerary, fallbackUsed } = await buildItinerary(input.destination, input.days, input.budget);
    const startAnchor =
      (await withTimeout(resolveAnchorFromDestination(startCity), 1_800)) ?? resolveAnchor(startCity);

    logger.info("TRIP_PREVIEW_COMPLETED", {
      destination: input.destination,
      days: input.days,
      budget: input.budget,
      elapsedMs: Date.now() - startTime,
      fallbackUsed,
    });

    return {
      preview: true,
      destination: input.destination,
      startCity,
      startLatitude: startAnchor.latitude,
      startLongitude: startAnchor.longitude,
      days: input.days,
      budget: input.budget,
      itinerary,
    };
  }

  async generateTrip(input: GenerateTripRequest, userId: string): Promise<TripDTO> {
    const startTime = Date.now();
    const startCity = (input.startCity ?? input.destination).trim();
    const { itinerary, fallbackUsed } = await buildItinerary(input.destination, input.days, input.budget);
    const startAnchor =
      (await withTimeout(resolveAnchorFromDestination(startCity), 1_800)) ?? resolveAnchor(startCity);

    const createdTrip = await prisma.$transaction(
      async (tx) => {
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
            startCity,
            startLatitude: startAnchor.latitude,
            startLongitude: startAnchor.longitude,
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
                    durationMinutes: activity.durationMinutes,
                    travelToNextMinutes: activity.travelToNextMinutes,
                    travelToNextKm: activity.travelToNextKm,
                    travelMode: activity.travelMode,
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
      },
      {
        maxWait: DB_TRANSACTION_MAX_WAIT_MS,
        timeout: DB_TRANSACTION_TIMEOUT_MS,
      }
    );

    logger.info("TRIP_GENERATE_PERSISTED", {
      tripId: createdTrip.id,
      userId,
      elapsedMs: Date.now() - startTime,
      fallbackUsed,
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
      page: query.page,
    };
  }

  async listExploreSpots(query: ExploreQuery, userId: string): Promise<ExploreSpotDTO[]> {
    const trips = await prisma.trip.findMany({
      where: { userId },
      include: tripInclude,
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const search = query.q?.trim().toLowerCase();
    const spots: ExploreSpotSeed[] = [];
    const seen = new Set<string>();

    outer:
    for (const trip of trips) {
      const firstActivity = trip.itineraryDays
        .slice()
        .sort((a, b) => a.dayNumber - b.dayNumber)[0]
        ?.activities.slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)[0];

      const destinationOriginLatitude = firstActivity?.latitude ?? trip.startLatitude ?? undefined;
      const destinationOriginLongitude = firstActivity?.longitude ?? trip.startLongitude ?? undefined;

      for (const day of trip.itineraryDays) {
        for (const activity of day.activities) {
          const key = `${activity.title.toLowerCase()}-${activity.latitude.toFixed(4)}-${activity.longitude.toFixed(4)}`;
          if (seen.has(key)) {
            continue;
          }

          const title = toTitleCase(activity.title);
          const location = toTitleCase(trip.destination);
          const searchable = `${title} ${location} ${activity.description}`.toLowerCase();
          if (search && !searchable.includes(search)) {
            continue;
          }

          seen.add(key);
          spots.push({
            id: key,
            title,
            subtitle: activity.time,
            location,
            latitude: activity.latitude,
            longitude: activity.longitude,
            originLatitude: destinationOriginLatitude,
            originLongitude: destinationOriginLongitude,
            source: "trip_history",
          });

          if (spots.length >= query.limit) {
            break outer;
          }
        }
      }
    }

    let fallbackIndex = 0;
    while (spots.length < query.limit && fallbackIndex < EXPLORE_FALLBACKS.length) {
      const fallback = EXPLORE_FALLBACKS[fallbackIndex];
      fallbackIndex += 1;

      const anchor = await resolveAnchorFromDestination(fallback.location);
      const searchable = `${fallback.title} ${fallback.subtitle} ${fallback.location}`.toLowerCase();
      if (search && !searchable.includes(search)) {
        continue;
      }

      spots.push({
        id: `fallback-${fallbackIndex}`,
        title: fallback.title,
        subtitle: fallback.subtitle,
        location: fallback.location,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        source: "fallback",
      });
    }

    if (!spots.length) {
      return [];
    }

    const placeEnriched = await Promise.all(spots.map((spot) => enrichSpotFromGooglePlaces(spot)));
    const withDistance = await applyGoogleDistanceMatrix(placeEnriched);

    return withDistance.map(({ originLatitude: _originLatitude, originLongitude: _originLongitude, ...spot }) => spot);
  }

  async updateTrip(tripId: string, payload: UpdateTripRequest, userId: string): Promise<TripDTO> {
    const requestStartedAt = Date.now();
    const result = await prisma.$transaction(
      async (tx) => {
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
            startCity: true,
          },
        });

        if (!existing) {
          throw new AppError(404, "NOT_FOUND", "Trip not found.");
        }

        const destination = payload.destination ?? existing.destination;
        const days = payload.days ?? existing.days;
        const budget = payload.budget ?? (existing.budget as BudgetTier);
        const startCity = (payload.startCity ?? existing.startCity).trim();
        const { itinerary } = await buildItinerary(destination, days, budget);
        const startAnchor =
          (await withTimeout(resolveAnchorFromDestination(startCity), 1_800)) ?? resolveAnchor(startCity);

        await tx.itineraryDay.deleteMany({
          where: { tripId: existing.id },
        });

        return tx.trip.update({
          where: { id: existing.id },
          data: {
            destination,
            startCity,
            startLatitude: startAnchor.latitude,
            startLongitude: startAnchor.longitude,
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
                    durationMinutes: activity.durationMinutes,
                    travelToNextMinutes: activity.travelToNextMinutes,
                    travelToNextKm: activity.travelToNextKm,
                    travelMode: activity.travelMode,
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
        maxWait: DB_TRANSACTION_MAX_WAIT_MS,
        timeout: DB_TRANSACTION_TIMEOUT_MS,
      }
    );

    logger.info("TRIP_UPDATE_PERSISTED", {
      tripId,
      userId,
      elapsedMs: Date.now() - requestStartedAt,
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
    const requestStartedAt = Date.now();
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
        startCity: true,
      },
    });

    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Trip not found.");
    }

    const days = payload.days ?? existing.days;
    const budget = payload.budget ?? (existing.budget as BudgetTier);
    const { itinerary } = await buildItinerary(existing.destination, days, budget);
    const startAnchor =
      (await withTimeout(resolveAnchorFromDestination(existing.startCity), 1_800)) ??
      resolveAnchor(existing.startCity);

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.itineraryDay.deleteMany({ where: { tripId: existing.id } });

        return tx.trip.update({
          where: { id: existing.id },
          data: {
            days,
            budget,
            startLatitude: startAnchor.latitude,
            startLongitude: startAnchor.longitude,
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
                    durationMinutes: activity.durationMinutes,
                    travelToNextMinutes: activity.travelToNextMinutes,
                    travelToNextKm: activity.travelToNextKm,
                    travelMode: activity.travelMode,
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
        maxWait: DB_TRANSACTION_MAX_WAIT_MS,
        timeout: DB_TRANSACTION_TIMEOUT_MS,
      }
    );

    logger.info("TRIP_REGENERATE_PERSISTED", {
      tripId,
      userId,
      elapsedMs: Date.now() - requestStartedAt,
    });

    return mapTripResponse(result);
  }
}

export const tripService = new TripService();
