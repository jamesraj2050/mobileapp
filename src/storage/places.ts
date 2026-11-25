import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Trip } from '@/types/expense';
import { formatPlaceName } from '@/utils/format';

export type PlaceEntry = {
  name: string;
  count: number;
  lastUsedAt: string;
};

export type PlaceMemory = {
  places: PlaceEntry[];
  lastFrom: string | null;
  lastTo: string | null;
};

const MAX_PLACES = 40;

function placesKey(userId: string): string {
  return `place_memory_v1:${userId}`;
}

function normalizePlace(raw: string): string {
  return formatPlaceName(raw.trim().replace(/\s+/g, ' '));
}

function emptyMemory(): PlaceMemory {
  return { places: [], lastFrom: null, lastTo: null };
}

function bumpPlace(places: PlaceEntry[], name: string, at: string): PlaceEntry[] {
  const key = name.toLowerCase();
  const existing = places.find((p) => p.name.toLowerCase() === key);
  const next = existing
    ? places.map((p) =>
        p.name.toLowerCase() === key
          ? { name: p.name, count: p.count + 1, lastUsedAt: at }
          : p
      )
    : [{ name, count: 1, lastUsedAt: at }, ...places];

  return next
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    })
    .slice(0, MAX_PLACES);
}

/** Merge trip history into stored memory (trips win for lastFrom/lastTo if newer). */
export function mergeTripsIntoMemory(memory: PlaceMemory, trips: Trip[]): PlaceMemory {
  let places = [...memory.places];
  let lastFrom = memory.lastFrom;
  let lastTo = memory.lastTo;

  const sorted = [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const trip of sorted) {
    const from = normalizePlace(trip.from);
    const to = normalizePlace(trip.to);
    if (from) places = bumpPlace(places, from, trip.updatedAt);
    if (to) places = bumpPlace(places, to, trip.updatedAt);
  }

  if (sorted[0]) {
    const from = normalizePlace(sorted[0].from);
    const to = normalizePlace(sorted[0].to);
    if (from) lastFrom = from;
    if (to) lastTo = to;
  }

  return { places, lastFrom, lastTo };
}

export async function loadPlaceMemory(userId: string): Promise<PlaceMemory> {
  if (!userId) return emptyMemory();
  const raw = await AsyncStorage.getItem(placesKey(userId));
  if (!raw) return emptyMemory();
  try {
    const parsed = JSON.parse(raw) as Partial<PlaceMemory>;
    return {
      places: Array.isArray(parsed.places) ? parsed.places : [],
      lastFrom: typeof parsed.lastFrom === 'string' ? parsed.lastFrom : null,
      lastTo: typeof parsed.lastTo === 'string' ? parsed.lastTo : null,
    };
  } catch {
    return emptyMemory();
  }
}

export async function rememberTripPlaces(
  userId: string,
  from: string,
  to: string
): Promise<PlaceMemory> {
  if (!userId) return emptyMemory();
  const at = new Date().toISOString();
  const current = await loadPlaceMemory(userId);
  const fromNorm = normalizePlace(from);
  const toNorm = normalizePlace(to);
  let places = current.places;
  if (fromNorm) places = bumpPlace(places, fromNorm, at);
  if (toNorm) places = bumpPlace(places, toNorm, at);
  const next: PlaceMemory = {
    places,
    lastFrom: fromNorm || current.lastFrom,
    lastTo: toNorm || current.lastTo,
  };
  await AsyncStorage.setItem(placesKey(userId), JSON.stringify(next));
  return next;
}

/** Ranked suggestions: last used first when empty query, else prefix/substring match. */
export function suggestPlaces(
  memory: PlaceMemory,
  query: string,
  exclude: string | null = null,
  limit = 5
): string[] {
  const q = query.trim().toLowerCase();
  const excludeKey = exclude?.trim().toLowerCase() ?? '';
  const ranked = [...memory.places].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });

  const filtered = ranked.filter((p) => {
    if (excludeKey && p.name.toLowerCase() === excludeKey) return false;
    if (!q) return true;
    return p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q);
  });

  return filtered.slice(0, limit).map((p) => p.name);
}

export function bestGuessFrom(memory: PlaceMemory): string {
  return memory.lastFrom?.trim() || memory.places[0]?.name || '';
}

export function bestGuessTo(memory: PlaceMemory, from: string): string {
  const fromKey = from.trim().toLowerCase();
  if (memory.lastTo && memory.lastTo.toLowerCase() !== fromKey) {
    return memory.lastTo;
  }
  const alt = memory.places.find((p) => p.name.toLowerCase() !== fromKey);
  return alt?.name ?? '';
}
