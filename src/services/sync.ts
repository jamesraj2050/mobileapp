import { fetchRemoteTrips, postSync, uploadReceiptAuthenticated } from '@/services/api';
import {
  loadLocalTrips,
  replaceLocalTrips,
  saveLocalTrips,
  updateLocalExpense,
} from '@/storage/local-store';
import type { Expense, Trip } from '@/types/expense';

let syncInFlightForUser: string | null = null;
let syncInFlight: Promise<Trip[]> | null = null;

/**
 * Merge server trips for THIS user with that user's local pending edits.
 * Never keeps trips that are not in local (this user) or remote (this user).
 * Local-only pending trips are kept only when they belong to this user's store.
 */
function mergeRemoteWithLocal(local: Trip[], remote: Trip[]): Trip[] {
  const localById = new Map(local.map((t) => [t.id, t]));
  const remoteIds = new Set(remote.map((t) => t.id));

  const mergedRemote = remote.map((remoteTrip) => {
    const localTrip = localById.get(remoteTrip.id);
    if (!localTrip) return remoteTrip;

    const localExpensesById = new Map(localTrip.expenses.map((e) => [e.id, e]));
    const expenses = remoteTrip.expenses.map((remoteExpense) => {
      const localExpense = localExpensesById.get(remoteExpense.id);
      if (!localExpense) return remoteExpense;

      // Prefer local when metadata or receipt upload is still in flight
      if (localExpense.syncStatus !== 'synced' || localExpense.receiptUploadStatus !== 'synced') {
        return {
          ...localExpense,
          receiptKey: remoteExpense.receiptKey ?? localExpense.receiptKey,
          receiptUploadStatus: remoteExpense.receiptKey
            ? 'synced'
            : localExpense.receiptUploadStatus,
        };
      }

      return {
        ...remoteExpense,
        localReceiptUri: localExpense.localReceiptUri,
        receiptUploadStatus: remoteExpense.receiptKey
          ? 'synced'
          : localExpense.localReceiptUri
            ? localExpense.receiptUploadStatus
            : 'synced',
      };
    });

    for (const localExpense of localTrip.expenses) {
      const stillPending =
        localExpense.syncStatus !== 'synced' || localExpense.receiptUploadStatus !== 'synced';
      if (!expenses.some((e) => e.id === localExpense.id) && stillPending) {
        expenses.unshift(localExpense);
      }
    }

    if (localTrip.syncStatus !== 'synced') {
      return {
        ...localTrip,
        expenses,
      };
    }

    return {
      ...remoteTrip,
      expenses,
    };
  });

  const localOnly = local.filter(
    (trip) => !remoteIds.has(trip.id) && trip.syncStatus !== 'synced'
  );
  return [...localOnly, ...mergedRemote];
}

function mimeFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * If the user created a trip/expense while sync was running, keep those disk writes.
 * Without this, replaceLocalTrips would wipe the new trip → "Trip not found".
 */
async function reconcileWithDisk(userId: string, working: Trip[]): Promise<Trip[]> {
  const disk = await loadLocalTrips(userId);
  const workingIds = new Set(working.map((t) => t.id));
  const extras = disk.filter(
    (trip) => !workingIds.has(trip.id) && trip.syncStatus !== 'synced'
  );

  const merged = [...extras, ...working];
  await replaceLocalTrips(userId, merged);
  return merged;
}

async function syncMetadata(userId: string, local: Trip[]): Promise<Trip[]> {
  const pendingTrips = local.filter(
    (t) => t.syncStatus === 'pending' || t.syncStatus === 'syncing' || t.syncStatus === 'failed'
  );
  const pendingExpenses = local.flatMap((trip) =>
    trip.expenses
      .filter(
        (e) => e.syncStatus === 'pending' || e.syncStatus === 'syncing' || e.syncStatus === 'failed'
      )
      .map((e) => ({ ...e, tripId: trip.id }))
  );

  if (pendingTrips.length === 0 && pendingExpenses.length === 0) {
    const remote = await fetchRemoteTrips();
    return mergeRemoteWithLocal(local, remote);
  }

  const result = await postSync({
    trips: pendingTrips.map((t) => ({
      id: t.id,
      from: t.from,
      to: t.to,
      startDate: t.startDate,
      endDate: t.endDate,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    expenses: pendingExpenses.map((e) => {
      const expense = e as Expense & { tripId: string };
            return {
              id: expense.id,
              tripId: expense.tripId,
              type: expense.type,
              date: expense.date,
              amount: expense.amount,
              description: expense.description,
              details: expense.details ?? {},
              receiptUri: expense.receiptUri,
              receiptKey: expense.receiptKey,
              receiptStatus: expense.receiptStatus,
              receiptDetectedAmount: expense.receiptDetectedAmount,
              createdAt: expense.createdAt,
              updatedAt: expense.updatedAt,
            };
    }),
  });

  const syncedTrip = new Set(result.syncedTripIds);
  const syncedExpense = new Set(result.syncedExpenseIds);

  const updated = local.map((trip) => ({
    ...trip,
    syncStatus: syncedTrip.has(trip.id)
      ? ('synced' as const)
      : trip.syncStatus === 'syncing'
        ? ('failed' as const)
        : trip.syncStatus,
    expenses: trip.expenses.map((expense) => ({
      ...expense,
      syncStatus: syncedExpense.has(expense.id)
        ? ('synced' as const)
        : expense.syncStatus === 'syncing'
          ? ('failed' as const)
          : expense.syncStatus,
    })),
  }));

  return mergeRemoteWithLocal(updated, result.trips);
}

async function uploadPendingReceipts(userId: string, trips: Trip[]): Promise<Trip[]> {
  let current = trips;

  const snapshot = () =>
    current.flatMap((trip) =>
      trip.expenses.map((expense) => ({ tripId: trip.id, expense }))
    );

  for (const { tripId, expense } of snapshot()) {
    const needsUpload =
      !!expense.localReceiptUri &&
      !expense.receiptKey &&
      (expense.receiptUploadStatus === 'pending' ||
        expense.receiptUploadStatus === 'failed' ||
        expense.receiptUploadStatus === 'syncing');

    if (!needsUpload || !expense.localReceiptUri) continue;

    // Expense must exist on the server before R2 upload (ownership check).
    const latest = current
      .find((t) => t.id === tripId)
      ?.expenses.find((e) => e.id === expense.id);
    if (!latest || (latest.syncStatus !== 'synced' && latest.syncStatus !== 'syncing')) {
      continue;
    }
    if (latest.receiptKey) continue;

    current = await updateLocalExpense(userId, tripId, expense.id, {
      receiptUploadStatus: 'syncing',
    });

    try {
      const { key } = await uploadReceiptAuthenticated({
        localUri: expense.localReceiptUri,
        mimeType: mimeFromUri(expense.localReceiptUri),
        tripId,
        expenseId: expense.id,
      });

      current = await updateLocalExpense(userId, tripId, expense.id, {
        receiptKey: key,
        receiptStatus: 'attached',
        receiptUploadStatus: 'synced',
        // Push receipt_key to Turso on next metadata sync
        syncStatus: 'pending',
      });
    } catch {
      current = await updateLocalExpense(userId, tripId, expense.id, {
        receiptUploadStatus: 'failed',
      });
    }
  }

  return current;
}

/**
 * 1) Sync trip/expense metadata to Turso (so the Worker can authorize ownership)
 * 2) Upload pending receipt images to R2
 * 3) Sync again so receipt_key is stored in Turso
 */
export async function runBackgroundSync(userId: string): Promise<Trip[]> {
  if (!userId) return [];

  if (syncInFlight && syncInFlightForUser === userId) {
    return syncInFlight;
  }

  syncInFlightForUser = userId;
  syncInFlight = (async () => {
    let local = await loadLocalTrips(userId);

    local = local.map((trip) => ({
      ...trip,
      syncStatus:
        trip.syncStatus === 'pending' || trip.syncStatus === 'failed' ? 'syncing' : trip.syncStatus,
      expenses: trip.expenses.map((expense) => ({
        ...expense,
        syncStatus:
          expense.syncStatus === 'pending' || expense.syncStatus === 'failed'
            ? 'syncing'
            : expense.syncStatus,
      })),
    }));
    await saveLocalTrips(userId, local);

    try {
      // Step 1: metadata first (required before receipt upload)
      local = await syncMetadata(userId, local);
      local = await reconcileWithDisk(userId, local);

      // Step 2: upload receipts now that expenses exist server-side
      local = await uploadPendingReceipts(userId, local);
      local = await reconcileWithDisk(userId, local);

      // Step 3: push receipt_key updates if any uploads succeeded
      const needsKeySync = local.some((trip) =>
        trip.expenses.some(
          (e) => e.receiptKey && (e.syncStatus === 'pending' || e.syncStatus === 'failed')
        )
      );
      if (needsKeySync) {
        local = local.map((trip) => ({
          ...trip,
          expenses: trip.expenses.map((expense) =>
            expense.receiptKey && expense.syncStatus === 'pending'
              ? { ...expense, syncStatus: 'syncing' as const }
              : expense
          ),
        }));
        local = await syncMetadata(userId, local);
      }

      local = await reconcileWithDisk(userId, local);
      return local;
    } catch {
      local = (await loadLocalTrips(userId)).map((trip) => ({
        ...trip,
        syncStatus: trip.syncStatus === 'syncing' ? 'failed' : trip.syncStatus,
        expenses: trip.expenses.map((expense) => ({
          ...expense,
          syncStatus: expense.syncStatus === 'syncing' ? 'failed' : expense.syncStatus,
          receiptUploadStatus:
            expense.receiptUploadStatus === 'syncing' ? 'failed' : expense.receiptUploadStatus,
        })),
      }));
      await saveLocalTrips(userId, local);
      return local;
    }
  })().finally(() => {
    syncInFlight = null;
    syncInFlightForUser = null;
  });

  return syncInFlight;
}
