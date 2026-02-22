import { env } from "../config/env";
import { ActivityTime, BudgetTier } from "../types/trip";
import { logger } from "../utils/logger";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const AI_CACHE_TTL_MS = 1000 * 60 * 25;
const MAX_CANDIDATE_PLACES = 48;
const ACTIVITY_ORDER: ActivityTime[] = ["Morning", "Afternoon", "Evening"];

export type AIPlaceCandidate = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
};

export type AISuggestedActivity = {
  time: ActivityTime;
  placeId: string | null;
  title: string;
  description: string;
  hiddenGem: boolean;
};

export type AISuggestedDay = {
  dayNumber: number;
  activities: AISuggestedActivity[];
};

export type AISuggestedItinerary = {
  days: AISuggestedDay[];
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

const aiCache = new Map<string, CacheEntry<AISuggestedItinerary>>();

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

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  return content
    .map((entry) => entry.text ?? "")
    .join("")
    .trim();
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return null;
}

function normalizeTime(value: unknown): ActivityTime | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "morning") return "Morning";
  if (normalized === "afternoon") return "Afternoon";
  if (normalized === "evening") return "Evening";
  return null;
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";

  const compact = value
    .replace(/\s+/g, " ")
    .replace(/^[\-\*"\s]+/, "")
    .replace(/[\s"]+$/, "")
    .trim();

  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeModelResponse(
  raw: unknown,
  expectedDays: number,
  placeIdSet: Set<string>
): AISuggestedItinerary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  const dayListCandidate = Array.isArray(payload.days)
    ? payload.days
    : Array.isArray(payload.itinerary)
    ? payload.itinerary
    : null;

  if (!dayListCandidate) {
    return null;
  }

  const normalizedDays: AISuggestedDay[] = [];

  for (let dayNumber = 1; dayNumber <= expectedDays; dayNumber += 1) {
    const sourceDay = dayListCandidate.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }

      const candidateDayNumber = (entry as Record<string, unknown>).dayNumber;
      return typeof candidateDayNumber === "number" && candidateDayNumber === dayNumber;
    });

    if (!sourceDay || typeof sourceDay !== "object" || Array.isArray(sourceDay)) {
      return null;
    }

    const activitiesCandidate = (sourceDay as Record<string, unknown>).activities;
    if (!Array.isArray(activitiesCandidate)) {
      return null;
    }

    const byTime = new Map<ActivityTime, Record<string, unknown>>();

    for (const rawActivity of activitiesCandidate) {
      if (!rawActivity || typeof rawActivity !== "object" || Array.isArray(rawActivity)) {
        continue;
      }

      const record = rawActivity as Record<string, unknown>;
      const time = normalizeTime(record.time);
      if (!time || byTime.has(time)) {
        continue;
      }

      byTime.set(time, record);
    }

    const normalizedActivities: AISuggestedActivity[] = [];
    for (const expectedTime of ACTIVITY_ORDER) {
      const sourceActivity = byTime.get(expectedTime);
      if (!sourceActivity) {
        return null;
      }

      const placeIdRaw = sourceActivity.placeId;
      const placeId =
        typeof placeIdRaw === "string" && placeIdSet.has(placeIdRaw.trim()) ? placeIdRaw.trim() : null;

      const title = sanitizeText(sourceActivity.title, 84);
      const description = sanitizeText(sourceActivity.description, 220);

      if (!title || !description) {
        return null;
      }

      normalizedActivities.push({
        time: expectedTime,
        placeId,
        title,
        description,
        hiddenGem: sourceActivity.hiddenGem === true,
      });
    }

    normalizedDays.push({
      dayNumber,
      activities: normalizedActivities,
    });
  }

  return {
    days: normalizedDays,
  };
}

function buildRequestPrompt(
  destination: string,
  days: number,
  budget: BudgetTier,
  places: AIPlaceCandidate[]
): string {
  const placeLines = places.map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
  }));

  return JSON.stringify(
    {
      destination,
      budget,
      days,
      requiredTimes: ACTIVITY_ORDER,
      guidance: [
        "Prefer hidden, local, less-obvious places over tourist traps.",
        "Use only the placeId values from candidates.",
        "No duplicate places across itinerary unless unavoidable.",
        "Descriptions must be factual and concise, travel-card ready.",
      ],
      candidates: placeLines,
      outputShape: {
        days: [
          {
            dayNumber: 1,
            activities: [
              {
                time: "Morning|Afternoon|Evening",
                placeId: "candidate id or null",
                title: "short accurate title",
                description: "one concise sentence with practical context",
                hiddenGem: true,
              },
            ],
          },
        ],
      },
      strict: "Return JSON only. No markdown. No code fences.",
    },
    null,
    2
  );
}

async function callOpenAI(
  destination: string,
  days: number,
  budget: BudgetTier,
  places: AIPlaceCandidate[]
): Promise<AISuggestedItinerary | null> {
  if (!env.openaiApiKey) {
    return null;
  }

  const placeIdSet = new Set(places.map((place) => place.id));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.openaiTimeoutMs);

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.2,
        max_tokens: 2200,
        messages: [
          {
            role: "system",
            content:
              "You are a travel itinerary planner. Produce accurate structured JSON from supplied candidate places.",
          },
          {
            role: "user",
            content: buildRequestPrompt(destination, days, budget, places),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn("AI itinerary request failed.", response.status, body.slice(0, 240));
      return null;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = contentToText(payload.choices?.[0]?.message?.content);
    if (!content) {
      logger.warn("AI itinerary response was empty.");
      return null;
    }

    const jsonPayload = extractJsonObject(content);
    if (!jsonPayload) {
      logger.warn("AI itinerary response was not JSON.");
      return null;
    }

    const parsed = JSON.parse(jsonPayload) as unknown;
    return normalizeModelResponse(parsed, days, placeIdSet);
  } catch (error) {
    logger.warn("AI itinerary request exception.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAISuggestedItinerary(
  destination: string,
  days: number,
  budget: BudgetTier,
  placeCandidates: AIPlaceCandidate[]
): Promise<AISuggestedItinerary | null> {
  if (!env.openaiApiKey || placeCandidates.length === 0) {
    return null;
  }

  const candidates = placeCandidates.slice(0, MAX_CANDIDATE_PLACES);
  const placesHash = hashString(candidates.map((place) => place.id).join("|"));
  const cacheKey = `${normalizeDestination(destination)}|${days}|${budget}|${placesHash}`;
  const cached = getCachedValue(aiCache, cacheKey);
  if (cached) {
    return cached;
  }

  const generated = await callOpenAI(destination, days, budget, candidates);
  if (!generated) {
    return null;
  }

  setCachedValue(aiCache, cacheKey, generated, AI_CACHE_TTL_MS);
  return generated;
}
