import { ensureSchema, execute } from '@/db/turso';
import type { Expense, ExpenseType, ReceiptStatus, Trip, TripStatus } from '@/types/expense';

function mapExpense(row: Record<string, string | number | null>): Expense {
  return {
    id: String(row.id),
    type: String(row.type) as ExpenseType,
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    receiptUri: row.receipt_uri == null ? null : String(row.receipt_uri),
    receiptStatus: String(row.receipt_status) as ReceiptStatus,
    createdAt: String(row.created_at),
  };
}

function mapTrip(
  row: Record<string, string | number | null>,
  expenses: Expense[]
): Trip {
  return {
    id: String(row.id),
    from: String(row.from_city),
    to: String(row.to_city),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    name: String(row.name),
    status: String(row.status) as TripStatus,
    expenses,
    createdAt: String(row.created_at),
  };
}

export async function loadTrips(): Promise<Trip[]> {
  await ensureSchema();

  const tripsResult = await execute(
    'SELECT * FROM trips ORDER BY created_at DESC'
  );

  if (tripsResult.rows.length === 0) return [];

  const expensesResult = await execute(
    'SELECT * FROM expenses ORDER BY created_at DESC'
  );

  const byTrip = new Map<string, Expense[]>();
  for (const row of expensesResult.rows) {
    const tripId = String(row.trip_id);
    const list = byTrip.get(tripId) ?? [];
    list.push(mapExpense(row));
    byTrip.set(tripId, list);
  }

  return tripsResult.rows.map((row) => mapTrip(row, byTrip.get(String(row.id)) ?? []));
}

export async function insertTrip(trip: Trip): Promise<void> {
  await ensureSchema();
  await execute(
    `INSERT INTO trips (id, from_city, to_city, start_date, end_date, name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip.id,
      trip.from,
      trip.to,
      trip.startDate,
      trip.endDate,
      trip.name,
      trip.status,
      trip.createdAt,
    ]
  );
}

export async function insertExpense(tripId: string, expense: Expense): Promise<void> {
  await ensureSchema();
  await execute(
    `INSERT INTO expenses
     (id, trip_id, type, date, amount, description, receipt_uri, receipt_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expense.id,
      tripId,
      expense.type,
      expense.date,
      expense.amount,
      expense.description,
      expense.receiptUri,
      expense.receiptStatus,
      expense.createdAt,
    ]
  );
}

export async function updateTripStatus(tripId: string, status: TripStatus): Promise<void> {
  await ensureSchema();
  await execute('UPDATE trips SET status = ? WHERE id = ?', [status, tripId]);
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
