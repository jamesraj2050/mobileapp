import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import type { Expense, SyncStatus, Trip } from '@/types/expense';

const LEGACY_TRIPS_KEY = 'local_trips_v1';
const ACTIVE_USER_KEY = 'local_active_user_v1';

function tripsKey(userId: string): string {
  return `local_trips_v2:${userId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeExpense(raw: Partial<Expense> & { id: string }): Expense {
  return {
    id: raw.id,
    type: (raw.type as Expense['type']) ?? 'other',
    date: raw.date ?? nowIso().slice(0, 10),
    amount: Number(raw.amount ?? 0),
    description: raw.description ?? '',
    details: raw.details ?? {},
    receiptUri: raw.receiptUri ?? null,
    localReceiptUri: raw.localReceiptUri ?? raw.receiptUri ?? null,
    receiptKey: raw.receiptKey ?? null,
    receiptStatus: raw.receiptStatus ?? (raw.receiptUri || raw.localReceiptUri ? 'attached' : 'missing'),
    receiptDetectedAmount: raw.receiptDetectedAmount ?? null,
    receiptUploadStatus: (raw.receiptUploadStatus as SyncStatus) ?? 'pending',
    syncStatus: (raw.syncStatus as SyncStatus) ?? 'pending',
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? nowIso(),
  };
}

function normalizeTrip(raw: Partial<Trip> & { id: string }): Trip {
  return {
    id: raw.id,
    from: raw.from ?? '',
    to: raw.to ?? '',
    startDate: raw.startDate ?? '',
    endDate: raw.endDate ?? '',
    name: raw.name ?? '',
    status: (raw.status as Trip['status']) ?? 'active',
    expenses: (raw.expenses ?? []).map((e) => normalizeExpense(e)),
    syncStatus: (raw.syncStatus as SyncStatus) ?? 'pending',
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? nowIso(),
  };
}

/** One-time: remove unscoped legacy cache so it cannot leak across accounts. */
export async function clearLegacySharedTrips(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_TRIPS_KEY);
}

export async function getActiveLocalUserId(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_USER_KEY);
}

export async function setActiveLocalUserId(userId: string | null): Promise<void> {
  if (!userId) {
    await AsyncStorage.removeItem(ACTIVE_USER_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_USER_KEY, userId);
}

export async function loadLocalTrips(userId: string): Promise<Trip[]> {
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(tripsKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Trip[];
    return parsed.map((trip) => normalizeTrip(trip));
  } catch {
    return [];
  }
}

export async function saveLocalTrips(userId: string, trips: Trip[]): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(tripsKey(userId), JSON.stringify(trips));
}

export async function insertLocalTrip(userId: string, trip: Trip): Promise<Trip[]> {
  const trips = await loadLocalTrips(userId);
  const next = [normalizeTrip(trip), ...trips.filter((t) => t.id !== trip.id)];
  await saveLocalTrips(userId, next);
  return next;
}

export async function replaceLocalTrips(userId: string, trips: Trip[]): Promise<void> {
  await saveLocalTrips(
    userId,
    trips.map((t) => normalizeTrip(t))
  );
}

async function deleteManagedReceiptCopies(userId: string, trips: Trip[]): Promise<void> {
  const managedFolder = FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}receipts/${userId}/`
    : null;
  if (!managedFolder) return;

  const managedUris = new Set(
    trips
      .flatMap((trip) =>
        trip.expenses.flatMap((expense) => [expense.localReceiptUri, expense.receiptUri])
      )
      .filter((uri): uri is string => Boolean(uri?.startsWith(managedFolder)))
  );
  await Promise.all(
    [...managedUris].map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
    )
  );
}

export async function deleteLocalTrip(userId: string, tripId: string): Promise<Trip[]> {
  const trips = await loadLocalTrips(userId);
  const removed = trips.filter((trip) => trip.id === tripId);
  if (removed.length === 0) return trips;

  await deleteManagedReceiptCopies(userId, removed);
  const retained = trips.filter((trip) => trip.id !== tripId);
  await saveLocalTrips(userId, retained);
  return retained;
}

export async function insertLocalExpense(
  userId: string,
  tripId: string,
  expense: Expense
): Promise<Trip[]> {
  const trips = await loadLocalTrips(userId);
  const next = trips.map((trip) => {
    if (trip.id !== tripId) return trip;
    const without = trip.expenses.filter((e) => e.id !== expense.id);
    return {
      ...trip,
      expenses: [normalizeExpense(expense), ...without],
      updatedAt: nowIso(),
      syncStatus: trip.syncStatus === 'synced' ? 'pending' : trip.syncStatus,
    };
  });
  await saveLocalTrips(userId, next);
  return next;
}

export async function updateLocalExpense(
  userId: string,
  tripId: string,
  expenseId: string,
  patch: Partial<Expense>
): Promise<Trip[]> {
  const trips = await loadLocalTrips(userId);
  const next = trips.map((trip) => {
    if (trip.id !== tripId) return trip;
    return {
      ...trip,
      expenses: trip.expenses.map((expense) =>
        expense.id === expenseId
          ? normalizeExpense({ ...expense, ...patch, updatedAt: nowIso() })
          : expense
      ),
      updatedAt: nowIso(),
    };
  });
  await saveLocalTrips(userId, next);
  return next;
}

export async function updateLocalTripStatus(
  userId: string,
  tripId: string,
  status: Trip['status']
): Promise<Trip[]> {
  const trips = await loadLocalTrips(userId);
  const next = trips.map((trip) =>
    trip.id === tripId
      ? {
          ...trip,
          status,
          updatedAt: nowIso(),
          syncStatus: 'pending' as SyncStatus,
        }
      : trip
  );
  await saveLocalTrips(userId, next);
  return next;
}

/** Persist a captured receipt into app document storage so it survives restarts. */
export async function persistReceiptLocally(
  sourceUri: string,
  userId: string,
  expenseId: string
): Promise<string> {
  const baseDir = FileSystem.documentDirectory;
  if (!baseDir) {
    return sourceUri;
  }

  const folder = `${baseDir}receipts/${userId}/`;
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);

  const lower = sourceUri.toLowerCase();
  const ext = lower.includes('.pdf')
    ? 'pdf'
    : lower.includes('.png')
      ? 'png'
      : lower.includes('.webp')
        ? 'webp'
        : 'jpg';

  const dest = `${folder}${expenseId}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

export function tripTotal(trip: Trip): number {
  return trip.expenses.reduce((sum, e) => sum + e.amount, 0);
}

export function receiptCounts(trip: Trip): {
  expenses: number;
  receipts: number;
  missing: number;
} {
  const expenses = trip.expenses.length;
  const receipts = trip.expenses.filter((e) => e.receiptStatus === 'attached').length;
  return { expenses, receipts, missing: expenses - receipts };
}

export function sortExpensesNewestFirst(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
