import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Expense, Trip } from '@/types/expense';

const STORAGE_KEY = 'travel_expense_trips_v1';

export async function loadTrips(): Promise<Trip[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Trip[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveTrips(trips: Trip[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
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
