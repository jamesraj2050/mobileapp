export type TripStatus = 'active' | 'finished';

export type ExpenseType =
  | 'flight'
  | 'car'
  | 'taxi'
  | 'meal'
  | 'lunch'
  | 'dinner'
  | 'bus'
  | 'parking'
  | 'other';

export type ReceiptStatus = 'attached' | 'missing';

export type Expense = {
  id: string;
  type: ExpenseType;
  date: string; // ISO date YYYY-MM-DD
  amount: number;
  description: string;
  receiptUri: string | null;
  receiptStatus: ReceiptStatus;
  createdAt: string;
};

export type Trip = {
  id: string;
  from: string;
  to: string;
  startDate: string; // ISO date YYYY-MM-DD
  endDate: string;
  name: string;
  status: TripStatus;
  expenses: Expense[];
  createdAt: string;
};
