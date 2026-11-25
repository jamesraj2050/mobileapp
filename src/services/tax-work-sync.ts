import {
  fetchRemoteTaxWorkExpenses,
  postTaxWorkSync,
  uploadTaxWorkReceiptAuthenticated,
} from '@/services/api';
import {
  loadLocalTaxWorkExpenses,
  saveLocalTaxWorkExpenses,
  updateLocalTaxWorkExpense,
} from '@/storage/tax-work-store';
import type { TaxWorkExpense } from '@/types/expense';

let activeSync: Promise<TaxWorkExpense[]> | null = null;
let activeUserId: string | null = null;

function mimeFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function merge(local: TaxWorkExpense[], remote: TaxWorkExpense[]): TaxWorkExpense[] {
  const localById = new Map(local.map((expense) => [expense.id, expense]));
  const remoteIds = new Set(remote.map((expense) => expense.id));
  const merged = remote.map((serverExpense) => {
    const localExpense = localById.get(serverExpense.id);
    if (!localExpense) return serverExpense;
    const hasPendingChange =
      localExpense.syncStatus !== 'synced' ||
      localExpense.receiptUploadStatus === 'pending' ||
      localExpense.receiptUploadStatus === 'failed' ||
      localExpense.receiptUploadStatus === 'syncing';
    if (hasPendingChange) {
      return {
        ...localExpense,
        receiptKey: serverExpense.receiptKey ?? localExpense.receiptKey,
        receiptUploadStatus: serverExpense.receiptKey
          ? ('synced' as const)
          : localExpense.receiptUploadStatus,
      };
    }
    return {
      ...serverExpense,
      localReceiptUri: localExpense.localReceiptUri,
      receiptUploadStatus: serverExpense.receiptKey ? 'synced' : localExpense.receiptUploadStatus,
    };
  });
  const localOnly = local.filter(
    (expense) => !remoteIds.has(expense.id) && expense.syncStatus !== 'synced'
  );
  return [...localOnly, ...merged].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );
}

async function reconcileWithDisk(
  userId: string,
  working: TaxWorkExpense[]
): Promise<TaxWorkExpense[]> {
  const disk = await loadLocalTaxWorkExpenses(userId);
  const workingById = new Map(working.map((expense) => [expense.id, expense]));
  const reconciled = working.map((expense) => {
    const diskExpense = disk.find((item) => item.id === expense.id);
    return diskExpense && diskExpense.updatedAt > expense.updatedAt ? diskExpense : expense;
  });
  for (const diskExpense of disk) {
    if (!workingById.has(diskExpense.id) && diskExpense.syncStatus !== 'synced') {
      reconciled.unshift(diskExpense);
    }
  }
  await saveLocalTaxWorkExpenses(userId, reconciled);
  return reconciled;
}

async function syncMetadata(
  userId: string,
  expenses: TaxWorkExpense[]
): Promise<TaxWorkExpense[]> {
  const pending = expenses.filter(
    (expense) => expense.syncStatus !== 'synced'
  );
  if (pending.length === 0) {
    return merge(expenses, await fetchRemoteTaxWorkExpenses());
  }
  const result = await postTaxWorkSync(pending);
  const syncedIds = new Set(result.syncedExpenseIds);
  return merge(
    expenses.map((expense) =>
      syncedIds.has(expense.id) ? { ...expense, syncStatus: 'synced' as const } : expense
    ),
    result.expenses
  );
}

async function uploadReceipts(
  userId: string,
  expenses: TaxWorkExpense[]
): Promise<TaxWorkExpense[]> {
  let current = expenses;
  for (const snapshot of expenses) {
    const needsUpload =
      snapshot.localReceiptUri &&
      !snapshot.receiptKey &&
      snapshot.receiptUploadStatus !== 'synced' &&
      snapshot.syncStatus === 'synced';
    if (!needsUpload || !snapshot.localReceiptUri) continue;

    current = await updateLocalTaxWorkExpense(userId, snapshot.id, {
      receiptUploadStatus: 'syncing',
    });
    try {
      const { key } = await uploadTaxWorkReceiptAuthenticated({
        localUri: snapshot.localReceiptUri,
        mimeType: mimeFromUri(snapshot.localReceiptUri),
        expenseId: snapshot.id,
      });
      current = await updateLocalTaxWorkExpense(userId, snapshot.id, {
        receiptKey: key,
        receiptStatus: 'attached',
        receiptUploadStatus: 'synced',
        syncStatus: 'pending',
      });
    } catch {
      current = await updateLocalTaxWorkExpense(userId, snapshot.id, {
        receiptUploadStatus: 'failed',
      });
    }
  }
  return current;
}

export async function runTaxWorkSync(userId: string): Promise<TaxWorkExpense[]> {
  if (!userId) return [];
  if (activeSync && activeUserId === userId) return activeSync;

  activeUserId = userId;
  activeSync = (async () => {
    let expenses = await loadLocalTaxWorkExpenses(userId);
    expenses = expenses.map((expense) => ({
      ...expense,
      syncStatus:
        expense.syncStatus === 'pending' || expense.syncStatus === 'failed'
          ? ('syncing' as const)
          : expense.syncStatus,
    }));
    await saveLocalTaxWorkExpenses(userId, expenses);
    try {
      expenses = await syncMetadata(userId, expenses);
      expenses = await reconcileWithDisk(userId, expenses);
      expenses = await uploadReceipts(userId, expenses);
      expenses = await reconcileWithDisk(userId, expenses);
      if (expenses.some((expense) => expense.syncStatus === 'pending')) {
        expenses = await syncMetadata(userId, expenses);
      }
      expenses = await reconcileWithDisk(userId, expenses);
      return expenses;
    } catch {
      expenses = (await loadLocalTaxWorkExpenses(userId)).map((expense) => ({
        ...expense,
        syncStatus:
          expense.syncStatus === 'syncing' ? ('failed' as const) : expense.syncStatus,
        receiptUploadStatus:
          expense.receiptUploadStatus === 'syncing'
            ? ('failed' as const)
            : expense.receiptUploadStatus,
      }));
      await saveLocalTaxWorkExpenses(userId, expenses);
      return expenses;
    }
  })().finally(() => {
    activeSync = null;
    activeUserId = null;
  });
  return activeSync;
}

