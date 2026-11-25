import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { ApiError, deleteRemoteTrip } from '@/services/api';
import { runBackgroundSync } from '@/services/sync';
import {
  clearLegacySharedTrips,
  deleteLocalTrip,
  insertLocalExpense,
  insertLocalTrip,
  loadLocalTrips,
  persistReceiptLocally,
  setActiveLocalUserId,
  updateLocalTripStatus,
} from '@/storage/local-store';
import type { Expense, ExpenseType, Trip } from '@/types/expense';
import { createId, formatPlaceName, todayIso } from '@/utils/format';

type TripContextValue = {
  trips: Trip[];
  ready: boolean;
  error: string | null;
  syncing: boolean;
  getTrip: (id: string) => Trip | undefined;
  createTrip: (input: {
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    name: string;
  }) => Promise<Trip>;
  addExpense: (
    tripId: string,
    expense: Omit<
      Expense,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'syncStatus'
      | 'receiptUploadStatus'
      | 'receiptKey'
      | 'localReceiptUri'
    > & {
      localReceiptUri?: string | null;
      receiptKey?: string | null;
      receiptDetectedAmount?: number | null;
    }
  ) => Promise<Expense | null>;
  /** Fast path: camera/file → local save → background sync. */
  saveReceiptExpense: (input: {
    tripId: string;
    localUri: string;
    amount: number;
    detectedAmount: number | null;
    type?: ExpenseType;
    description?: string;
  }) => Promise<Expense | null>;
  deleteTrip: (tripId: string) => Promise<void>;
  finishTrip: (tripId: string) => Promise<void>;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
};

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const loadedUserId = useRef<string | null>(null);

  const syncNow = useCallback(async () => {
    if (!userId) return;
    setSyncing(true);
    try {
      await runBackgroundSync(userId);
      // Always re-read disk so concurrent createTrip writes are not wiped from UI
      const latest = await loadLocalTrips(userId);
      if (loadedUserId.current === userId) {
        setTrips(latest);
        setError(null);
      }
    } catch (e) {
      if (loadedUserId.current === userId) {
        setError(e instanceof Error ? e.message : 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [userId]);

  // Load (or clear) trips whenever the signed-in user changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setReady(false);
      await clearLegacySharedTrips();

      if (!userId) {
        loadedUserId.current = null;
        await setActiveLocalUserId(null);
        if (!cancelled) {
          setTrips([]);
          setError(null);
          setReady(true);
        }
        return;
      }

      await setActiveLocalUserId(userId);
      try {
        const local = await loadLocalTrips(userId);
        if (!cancelled) {
          loadedUserId.current = userId;
          setTrips(local);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          loadedUserId.current = userId;
          setTrips([]);
          setError(e instanceof Error ? e.message : 'Failed to load local trips');
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Background sync for the active user only
  useEffect(() => {
    if (!userId || !ready || loadedUserId.current !== userId) return;

    void syncNow();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncNow();
      }
    });

    const interval = setInterval(() => {
      void syncNow();
    }, 60_000);

    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [userId, ready, syncNow]);

  const getTrip = useCallback((id: string) => trips.find((t) => t.id === id), [trips]);

  const createTrip = useCallback(
    async (input: {
      from: string;
      to: string;
      startDate: string;
      endDate: string;
      name: string;
    }) => {
      if (!userId) {
        throw new Error('Sign in required to create a trip');
      }
      const now = new Date().toISOString();
      const trip: Trip = {
        id: createId(),
        from: formatPlaceName(input.from.trim()),
        to: formatPlaceName(input.to.trim()),
        startDate: input.startDate,
        endDate: input.endDate,
        name: input.name.trim(),
        status: 'active',
        expenses: [],
        syncStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      const next = await insertLocalTrip(userId, trip);
      setTrips(next);
      // Defer sync so navigation can mount with the new trip already in state/disk
      setTimeout(() => {
        void syncNow();
      }, 750);
      return trip;
    },
    [userId, syncNow]
  );

  const addExpense = useCallback(
    async (
      tripId: string,
      expenseInput: Omit<
        Expense,
        | 'id'
        | 'createdAt'
        | 'updatedAt'
        | 'syncStatus'
        | 'receiptUploadStatus'
        | 'receiptKey'
        | 'localReceiptUri'
      > & {
        localReceiptUri?: string | null;
        receiptKey?: string | null;
        receiptDetectedAmount?: number | null;
      }
    ) => {
      if (!userId) {
        throw new Error('Sign in required to add an expense');
      }
      const now = new Date().toISOString();
      const expense: Expense = {
        id: createId(),
        type: expenseInput.type,
        date: expenseInput.date,
        amount: expenseInput.amount,
        description: expenseInput.description,
        details: expenseInput.details ?? {},
        receiptUri: expenseInput.receiptUri,
        localReceiptUri: expenseInput.localReceiptUri ?? expenseInput.receiptUri,
        receiptKey: expenseInput.receiptKey ?? null,
        receiptStatus: expenseInput.receiptStatus,
        receiptDetectedAmount: expenseInput.receiptDetectedAmount ?? null,
        receiptUploadStatus: expenseInput.receiptKey
          ? 'synced'
          : expenseInput.localReceiptUri || expenseInput.receiptUri
            ? 'pending'
            : 'synced',
        syncStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      const next = await insertLocalExpense(userId, tripId, expense);
      setTrips(next);
      void syncNow();
      return expense;
    },
    [userId, syncNow]
  );

  const saveReceiptExpense = useCallback(
    async (input: {
      tripId: string;
      localUri: string;
      amount: number;
      detectedAmount: number | null;
      type?: ExpenseType;
      description?: string;
    }) => {
      if (!userId) {
        throw new Error('Sign in required to save a receipt');
      }
      const expenseId = createId();
      const localPath = await persistReceiptLocally(input.localUri, userId, expenseId);
      const now = new Date().toISOString();
      const expense: Expense = {
        id: expenseId,
        type: input.type ?? 'other',
        date: todayIso(),
        amount: input.amount,
        description: input.description ?? '',
        details: {},
        receiptUri: localPath,
        localReceiptUri: localPath,
        receiptKey: null,
        receiptStatus: 'attached',
        receiptDetectedAmount: input.detectedAmount,
        receiptUploadStatus: 'pending',
        syncStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      const next = await insertLocalExpense(userId, input.tripId, expense);
      setTrips(next);
      void syncNow();
      return expense;
    },
    [userId, syncNow]
  );

  const finishTrip = useCallback(
    async (tripId: string) => {
      if (!userId) {
        throw new Error('Sign in required');
      }
      const next = await updateLocalTripStatus(userId, tripId, 'finished');
      setTrips(next);
      void syncNow();
    },
    [userId, syncNow]
  );

  const deleteTrip = useCallback(
    async (tripId: string) => {
      if (!userId) {
        throw new Error('Sign in required');
      }

      // Finish any active sync first so stale sync results cannot restore the deleted trip.
      await syncNow();
      try {
        await deleteRemoteTrip(tripId);
      } catch (error) {
        // Failed/local-only and already-expired trips may not have a cloud row.
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 410)) {
          throw error;
        }
      }
      const next = await deleteLocalTrip(userId, tripId);
      setTrips(next);
    },
    [userId, syncNow]
  );

  const refresh = useCallback(async () => {
    if (!userId) {
      setTrips([]);
      return;
    }
    setReady(false);
    try {
      const local = await loadLocalTrips(userId);
      setTrips(local);
      await syncNow();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setReady(true);
    }
  }, [userId, syncNow]);

  const value = useMemo(
    () => ({
      trips,
      ready,
      error,
      syncing,
      getTrip,
      createTrip,
      addExpense,
      saveReceiptExpense,
      deleteTrip,
      finishTrip,
      refresh,
      syncNow,
    }),
    [
      trips,
      ready,
      error,
      syncing,
      getTrip,
      createTrip,
      addExpense,
      saveReceiptExpense,
      deleteTrip,
      finishTrip,
      refresh,
      syncNow,
    ]
  );

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrips() {
  const ctx = useContext(TripContext);
  if (!ctx) {
    throw new Error('useTrips must be used within TripProvider');
  }
  return ctx;
}
