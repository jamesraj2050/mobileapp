export type TripStatus = 'active' | 'finished';

export type ExpenseType =
  | 'flight'
  | 'car'
  | 'taxi'
  | 'meal'
  | 'lunch'
  | 'dinner'
  | 'bus'
  | 'train'
  | 'accommodation'
  | 'parking'
  | 'other';

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner';

export type ReceiptStatus = 'attached' | 'missing';

/** Local sync lifecycle for trips/expenses. */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/** Type-specific optional details captured on Add Expense. */
export type ExpenseDetails = {
  fromLocation?: string;
  toLocation?: string;
  stayStartDate?: string;
  stayEndDate?: string;
  hotelName?: string;
  mealPeriod?: MealPeriod;
};

export type Expense = {
  id: string;
  type: ExpenseType;
  date: string; // ISO date YYYY-MM-DD
  amount: number;
  description: string;
  details: ExpenseDetails;
  receiptUri: string | null;
  /** Local filesystem URI kept until R2 upload succeeds. */
  localReceiptUri: string | null;
  receiptKey: string | null;
  receiptStatus: ReceiptStatus;
  receiptDetectedAmount: number | null;
  receiptUploadStatus: SyncStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type TaxWorkOtherType = 'house_rent' | 'custom';

export type TaxWorkExpense = Expense & {
  expenseCategory: 'tax_work';
  currency: string;
  otherType: TaxWorkOtherType | null;
  otherDescription: string;
  retentionPolicy: 'tax_work_3_year_minimum';
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
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: {
    id: string;
    email: string | null;
    name: string | null;
  };
};
