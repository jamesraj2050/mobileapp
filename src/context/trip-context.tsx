import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { loadTrips, saveTrips } from '@/storage/trips';
import type { Expense, Trip } from '@/types/expense';
import { createId } from '@/utils/format';

type TripContextValue = {
  trips: Trip[];
  ready: boolean;
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
};

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadTrips();
      if (!cancelled) {
        setTrips(loaded);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistUpdate = useCallback(async (updater: (prev: Trip[]) => Trip[]) => {
    let next: Trip[] = [];
    setTrips((prev) => {
      next = updater(prev);
      return next;
    });
    await saveTrips(next);
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
      await persistUpdate((prev) => [trip, ...prev]);
      return trip;
    },
    [persistUpdate]
  );

  const addExpense = useCallback(
    async (tripId: string, expenseInput: Omit<Expense, 'id' | 'createdAt'>) => {
      const expense: Expense = {
        ...expenseInput,
        id: createId('exp'),
        createdAt: new Date().toISOString(),
      };
      await persistUpdate((prev) =>
        prev.map((trip) =>
          trip.id === tripId ? { ...trip, expenses: [expense, ...trip.expenses] } : trip
        )
      );
      return expense;
    },
    [persistUpdate]
  );

  const finishTrip = useCallback(
    async (tripId: string) => {
      await persistUpdate((prev) =>
        prev.map((trip) =>
          trip.id === tripId ? { ...trip, status: 'finished' as const } : trip
        )
      );
    },
    [persistUpdate]
  );

  const value = useMemo(
    () => ({
      trips,
      ready,
      getTrip,
      createTrip,
      addExpense,
      finishTrip,
    }),
    [trips, ready, getTrip, createTrip, addExpense, finishTrip]
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
