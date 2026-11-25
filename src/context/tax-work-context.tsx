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
import {
  ApiError,
  deleteRemoteTaxWorkExpense,
  fetchHiddenTaxWorkYears,
  hideRemoteTaxWorkYear,
  permanentlyDeleteRemoteTaxWorkYear,
  restoreRemoteTaxWorkYear,
} from '@/services/api';
import { runTaxWorkSync } from '@/services/tax-work-sync';
import { persistReceiptLocally } from '@/storage/local-store';
import {
  deleteLocalTaxWorkExpense,
  deleteLocalTaxWorkYear,
  loadLocalHiddenTaxWorkYears,
  loadLocalTaxWorkExpenses,
  saveLocalHiddenTaxWorkYears,
  updateLocalTaxWorkExpense,
  upsertLocalTaxWorkExpense,
} from '@/storage/tax-work-store';
import type { ExpenseType, TaxWorkExpense, TaxWorkOtherType } from '@/types/expense';
import { createId } from '@/utils/format';

type CreateTaxWorkExpenseInput = {
  type: ExpenseType;
  description: string;
  currency: string;
  otherType: TaxWorkOtherType | null;
  otherDescription: string;
  date: string;
  amount: number;
  receiptDetectedAmount: number | null;
  localReceiptUri: string | null;
};

type TaxWorkContextValue = {
  expenses: TaxWorkExpense[];
  hiddenYears: number[];
  ready: boolean;
  syncing: boolean;
  error: string | null;
  getExpense: (id: string) => TaxWorkExpense | undefined;
  addExpense: (input: CreateTaxWorkExpenseInput) => Promise<TaxWorkExpense>;
  updateExpense: (id: string, patch: Partial<TaxWorkExpense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  hideYear: (year: number) => Promise<void>;
  restoreYear: (year: number) => Promise<void>;
  permanentlyDeleteYear: (year: number) => Promise<void>;
  syncNow: () => Promise<void>;
};

const TaxWorkContext = createContext<TaxWorkContextValue | null>(null);

export function TaxWorkProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [expenses, setExpenses] = useState<TaxWorkExpense[]>([]);
  const [hiddenYears, setHiddenYears] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedUserId = useRef<string | null>(null);

  const syncNow = useCallback(async () => {
    if (!userId) return;
    setSyncing(true);
    try {
      await runTaxWorkSync(userId);
      const remoteHiddenYears = await fetchHiddenTaxWorkYears();
      await saveLocalHiddenTaxWorkYears(userId, remoteHiddenYears);
      if (loadedUserId.current === userId) {
        setExpenses(await loadLocalTaxWorkExpenses(userId));
        setHiddenYears(remoteHiddenYears);
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sync receipts');
    } finally {
      setSyncing(false);
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      if (!userId) {
        loadedUserId.current = null;
        if (!cancelled) {
          setExpenses([]);
          setHiddenYears([]);
          setError(null);
          setReady(true);
        }
        return;
      }
      loadedUserId.current = userId;
      const [local, localHiddenYears] = await Promise.all([
        loadLocalTaxWorkExpenses(userId),
        loadLocalHiddenTaxWorkYears(userId),
      ]);
      if (!cancelled) {
        setExpenses(local);
        setHiddenYears(localHiddenYears);
        setReady(true);
      }
    })().catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : 'Could not load receipts');
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !ready || loadedUserId.current !== userId) return;
    void syncNow();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [ready, syncNow, userId]);

  const addExpense = useCallback(
    async (input: CreateTaxWorkExpenseInput) => {
      if (!userId) throw new Error('Sign in required');
      const id = createId();
      const now = new Date().toISOString();
      const localReceiptUri = input.localReceiptUri
        ? await persistReceiptLocally(input.localReceiptUri, userId, id)
        : null;
      const expense: TaxWorkExpense = {
        id,
        type: input.type,
        date: input.date,
        amount: input.amount,
        description: input.description.trim(),
        details: {},
        receiptUri: localReceiptUri,
        localReceiptUri,
        receiptKey: null,
        receiptStatus: localReceiptUri ? 'attached' : 'missing',
        receiptDetectedAmount: input.receiptDetectedAmount,
        receiptUploadStatus: localReceiptUri ? 'pending' : 'synced',
        syncStatus: 'pending',
        expenseCategory: 'tax_work',
        currency: input.currency,
        otherType: input.type === 'other' ? input.otherType : null,
        otherDescription:
          input.type === 'other' ? input.otherDescription.trim() : '',
        retentionPolicy: 'tax_work_3_year_minimum',
        createdAt: now,
        updatedAt: now,
      };
      const next = await upsertLocalTaxWorkExpense(userId, expense);
      setExpenses(next);
      void syncNow();
      return expense;
    },
    [syncNow, userId]
  );

  const updateExpense = useCallback(
    async (id: string, patch: Partial<TaxWorkExpense>) => {
      if (!userId) throw new Error('Sign in required');
      const next = await updateLocalTaxWorkExpense(userId, id, {
        ...patch,
        syncStatus: 'pending',
      });
      setExpenses(next);
      void syncNow();
    },
    [syncNow, userId]
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      if (!userId) throw new Error('Sign in required');
      await syncNow();
      try {
        await deleteRemoteTaxWorkExpense(id);
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
      }
      setExpenses(await deleteLocalTaxWorkExpense(userId, id));
    },
    [syncNow, userId]
  );

  const hideYear = useCallback(
    async (year: number) => {
      if (!userId) throw new Error('Sign in required');
      const next = [...new Set([year, ...hiddenYears])].sort((a, b) => b - a);
      setHiddenYears(next);
      await saveLocalHiddenTaxWorkYears(userId, next);
      await hideRemoteTaxWorkYear(year);
    },
    [hiddenYears, userId]
  );

  const restoreYear = useCallback(
    async (year: number) => {
      if (!userId) throw new Error('Sign in required');
      const next = hiddenYears.filter((hiddenYear) => hiddenYear !== year);
      setHiddenYears(next);
      await saveLocalHiddenTaxWorkYears(userId, next);
      await restoreRemoteTaxWorkYear(year);
    },
    [hiddenYears, userId]
  );

  const permanentlyDeleteYear = useCallback(
    async (year: number) => {
      if (!userId) throw new Error('Sign in required');
      await syncNow();
      await permanentlyDeleteRemoteTaxWorkYear(year);
      setExpenses(await deleteLocalTaxWorkYear(userId, year));
      const next = hiddenYears.filter((hiddenYear) => hiddenYear !== year);
      setHiddenYears(next);
      await saveLocalHiddenTaxWorkYears(userId, next);
    },
    [hiddenYears, syncNow, userId]
  );

  const getExpense = useCallback(
    (id: string) => expenses.find((expense) => expense.id === id),
    [expenses]
  );

  const value = useMemo(
    () => ({
      expenses,
      hiddenYears,
      ready,
      syncing,
      error,
      getExpense,
      addExpense,
      updateExpense,
      deleteExpense,
      hideYear,
      restoreYear,
      permanentlyDeleteYear,
      syncNow,
    }),
    [
      addExpense,
      deleteExpense,
      error,
      expenses,
      hiddenYears,
      getExpense,
      ready,
      hideYear,
      restoreYear,
      permanentlyDeleteYear,
      syncNow,
      syncing,
      updateExpense,
    ]
  );
  return <TaxWorkContext.Provider value={value}>{children}</TaxWorkContext.Provider>;
}

export function useTaxWork() {
  const context = useContext(TaxWorkContext);
  if (!context) throw new Error('useTaxWork must be used within TaxWorkProvider');
  return context;
}

