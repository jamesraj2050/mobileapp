import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import type { TaxWorkExpense } from '@/types/expense';
import { normalizeCurrency } from '@/utils/currency';

function storageKey(userId: string): string {
  return `local_tax_work_expenses_v1:${userId}`;
}

function hiddenYearsKey(userId: string): string {
  return `local_tax_work_hidden_years_v1:${userId}`;
}

function normalizeExpense(raw: Partial<TaxWorkExpense> & { id: string }): TaxWorkExpense {
  const now = new Date().toISOString();
  return {
    id: raw.id,
    type: raw.type ?? 'other',
    date: raw.date ?? now.slice(0, 10),
    amount: Number(raw.amount ?? 0),
    description: raw.description ?? raw.otherDescription ?? '',
    details: raw.details ?? {},
    receiptUri: raw.receiptUri ?? null,
    localReceiptUri: raw.localReceiptUri ?? raw.receiptUri ?? null,
    receiptKey: raw.receiptKey ?? null,
    receiptStatus:
      raw.receiptStatus ?? (raw.localReceiptUri || raw.receiptUri ? 'attached' : 'missing'),
    receiptDetectedAmount: raw.receiptDetectedAmount ?? null,
    receiptUploadStatus: raw.receiptUploadStatus ?? 'pending',
    syncStatus: raw.syncStatus ?? 'pending',
    expenseCategory: 'tax_work',
    currency: normalizeCurrency(raw.currency),
    otherType: raw.type === 'other' ? raw.otherType ?? 'custom' : null,
    otherDescription: raw.type === 'other' ? raw.otherDescription ?? '' : '',
    retentionPolicy: 'tax_work_3_year_minimum',
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
  };
}

export async function loadLocalTaxWorkExpenses(userId: string): Promise<TaxWorkExpense[]> {
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as TaxWorkExpense[]).map(normalizeExpense);
  } catch {
    return [];
  }
}

export async function saveLocalTaxWorkExpenses(
  userId: string,
  expenses: TaxWorkExpense[]
): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(
    storageKey(userId),
    JSON.stringify(expenses.map(normalizeExpense))
  );
}

export async function loadLocalHiddenTaxWorkYears(userId: string): Promise<number[]> {
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(hiddenYearsKey(userId));
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as unknown[])
      .map(Number)
      .filter((year) => Number.isInteger(year));
  } catch {
    return [];
  }
}

export async function saveLocalHiddenTaxWorkYears(
  userId: string,
  years: number[]
): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(
    hiddenYearsKey(userId),
    JSON.stringify([...new Set(years)].sort((a, b) => b - a))
  );
}

export async function upsertLocalTaxWorkExpense(
  userId: string,
  expense: TaxWorkExpense
): Promise<TaxWorkExpense[]> {
  const expenses = await loadLocalTaxWorkExpenses(userId);
  const next = [
    normalizeExpense(expense),
    ...expenses.filter((item) => item.id !== expense.id),
  ];
  await saveLocalTaxWorkExpenses(userId, next);
  return next;
}

export async function updateLocalTaxWorkExpense(
  userId: string,
  expenseId: string,
  patch: Partial<TaxWorkExpense>
): Promise<TaxWorkExpense[]> {
  const expenses = await loadLocalTaxWorkExpenses(userId);
  const next = expenses.map((expense) =>
    expense.id === expenseId
      ? normalizeExpense({
          ...expense,
          ...patch,
          id: expense.id,
          updatedAt: patch.updatedAt ?? new Date().toISOString(),
        })
      : expense
  );
  await saveLocalTaxWorkExpenses(userId, next);
  return next;
}

export async function deleteLocalTaxWorkExpense(
  userId: string,
  expenseId: string
): Promise<TaxWorkExpense[]> {
  const expenses = await loadLocalTaxWorkExpenses(userId);
  const removed = expenses.find((expense) => expense.id === expenseId);
  if (removed?.localReceiptUri?.startsWith('file:')) {
    await FileSystem.deleteAsync(removed.localReceiptUri, { idempotent: true }).catch(
      () => undefined
    );
  }
  const next = expenses.filter((expense) => expense.id !== expenseId);
  await saveLocalTaxWorkExpenses(userId, next);
  return next;
}

export async function deleteLocalTaxWorkYear(
  userId: string,
  year: number
): Promise<TaxWorkExpense[]> {
  const expenses = await loadLocalTaxWorkExpenses(userId);
  const prefix = `${year}-`;
  const removed = expenses.filter((expense) => expense.date.startsWith(prefix));
  await Promise.all(
    removed.map((expense) =>
      expense.localReceiptUri?.startsWith('file:')
        ? FileSystem.deleteAsync(expense.localReceiptUri, { idempotent: true }).catch(
            () => undefined
          )
        : Promise.resolve()
    )
  );
  const retained = expenses.filter((expense) => !expense.date.startsWith(prefix));
  await saveLocalTaxWorkExpenses(userId, retained);
  const hiddenYears = await loadLocalHiddenTaxWorkYears(userId);
  await saveLocalHiddenTaxWorkYears(
    userId,
    hiddenYears.filter((hiddenYear) => hiddenYear !== year)
  );
  return retained;
}

