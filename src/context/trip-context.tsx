import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  insertExpense,
  insertTrip,
  loadTrips,
  updateTripStatus,
} from '@/storage/trips';
import type { Expense, Trip } from '@/types/expense';
import { createId } from '@/utils/format';

type PendingReceipt = {
  tripId: string;
  receiptUri: string;
  amount: string;
};

type TripContextValue = {
  trips: Trip[];
  ready: boolean;
  error: string | null;
  pendingReceipt: PendingReceipt | null;
  setPendingReceipt: (pending: PendingReceipt | null) => void;
  getTrip: (id: string) => Trip | undefined;
  createTrip: (input: {
    from: string;
    to: string;
    startDate: string;
    endDate: string;
    name: string;
  }) => Promise<Trip>;
  addExpense: (tripId: string, expense: Omit<Expense, 'id' | 'createdAt'>) => Promise<Expense | null>;
  finishTrip: (tripId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReceipt, setPendingReceipt] = useState<PendingReceipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await Promise.race([
          loadTrips(),
          new Promise<Trip[]>((_, reject) =>
            setTimeout(() => reject(new Error('Turso request timed out')), 12000)
          ),
        ]);
        if (!cancelled) {
          setTrips(loaded);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load trips from Turso');
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
  }, []);

  const getTrip = useCallback((id: string) => trips.find((t) => t.id === id), [trips]);

  const createTrip = useCallback(
    async (input: {
      from: string;
      to: string;
      startDate: string;
      endDate: string;
      name: string;
    }) => {
      const trip: Trip = {
        id: createId('trip'),
        from: input.from.trim(),
        to: input.to.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        name: input.name.trim(),
        status: 'active',
        expenses: [],
        createdAt: new Date().toISOString(),
      };
      await insertTrip(trip);
      setTrips((prev) => [trip, ...prev]);
      return trip;
    },
    []
  );

  const addExpense = useCallback(
    async (tripId: string, expenseInput: Omit<Expense, 'id' | 'createdAt'>) => {
      const expense: Expense = {
        ...expenseInput,
        id: createId('exp'),
        createdAt: new Date().toISOString(),
      };
      await insertExpense(tripId, expense);
      setTrips((prev) =>
        prev.map((trip) =>
          trip.id === tripId ? { ...trip, expenses: [expense, ...trip.expenses] } : trip
        )
      );
      return expense;
    },
    []
  );

  const finishTrip = useCallback(async (tripId: string) => {
    await updateTripStatus(tripId, 'finished');
    setTrips((prev) =>
      prev.map((trip) =>
        trip.id === tripId ? { ...trip, status: 'finished' as const } : trip
      )
    );
  }, []);

  const refresh = useCallback(async () => {
    setReady(false);
    try {
      const loaded = await loadTrips();
      setTrips(loaded);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trips from Turso');
    } finally {
      setReady(true);
    }
  }, []);

  const value = useMemo(
    () => ({
      trips,
      ready,
      error,
      pendingReceipt,
      setPendingReceipt,
      getTrip,
      createTrip,
      addExpense,
      finishTrip,
      refresh,
    }),
    [
      trips,
      ready,
      error,
      pendingReceipt,
      getTrip,
      createTrip,
      addExpense,
      finishTrip,
      refresh,
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
