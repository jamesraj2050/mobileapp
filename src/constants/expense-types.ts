import type { ExpenseType } from '@/types/expense';

export const EXPENSE_TYPES: {
  value: ExpenseType;
  label: string;
  icon: string;
}[] = [
  { value: 'flight', label: 'Flight', icon: '✈' },
  { value: 'car', label: 'Car', icon: '🚗' },
  { value: 'taxi', label: 'Taxi', icon: '🚕' },
  { value: 'meal', label: 'Meal', icon: '🍴' },
  { value: 'lunch', label: 'Lunch', icon: '🍴' },
  { value: 'dinner', label: 'Dinner', icon: '🍴' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'parking', label: 'Parking', icon: '🅿' },
  { value: 'other', label: 'Other', icon: '🧾' },
];

export function expenseTypeMeta(type: ExpenseType) {
  return EXPENSE_TYPES.find((t) => t.value === type) ?? EXPENSE_TYPES[EXPENSE_TYPES.length - 1];
}
