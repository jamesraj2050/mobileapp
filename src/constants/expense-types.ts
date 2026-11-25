import type { ExpenseDetails, ExpenseType, MealPeriod } from '@/types/expense';

export const EXPENSE_TYPES: {
  value: ExpenseType;
  label: string;
  icon: string;
}[] = [
  { value: 'flight', label: 'Flight', icon: '✈' },
  { value: 'car', label: 'Car', icon: '🚗' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'taxi', label: 'Taxi', icon: '🚕' },
  { value: 'train', label: 'Train', icon: '🚆' },
  { value: 'meal', label: 'Meal', icon: '🍴' },
  { value: 'accommodation', label: 'Accommodation', icon: '🏨' },
  { value: 'parking', label: 'Parking', icon: '🅿' },
  { value: 'other', label: 'Other', icon: '🧾' },
];

export const TAX_WORK_EXPENSE_TYPES = EXPENSE_TYPES.filter((item) =>
  ['flight', 'car', 'bus', 'taxi', 'train', 'meal', 'other'].includes(item.value)
);

export const MEAL_PERIODS: { value: MealPeriod; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
];

export const TRANSPORT_TYPES: ExpenseType[] = ['flight', 'car', 'bus', 'taxi', 'train'];

export function isTransportType(type: ExpenseType): boolean {
  return TRANSPORT_TYPES.includes(type);
}

export function expenseTypeMeta(type: ExpenseType) {
  if (type === 'lunch' || type === 'dinner') {
    return EXPENSE_TYPES.find((t) => t.value === 'meal') ?? EXPENSE_TYPES[EXPENSE_TYPES.length - 1];
  }
  return EXPENSE_TYPES.find((t) => t.value === type) ?? EXPENSE_TYPES[EXPENSE_TYPES.length - 1];
}

/** Build a short list label from type-specific details. */
export function buildExpenseDescription(
  type: ExpenseType,
  details: ExpenseDetails,
  fallback = ''
): string {
  if (isTransportType(type)) {
    const from = details.fromLocation?.trim();
    const to = details.toLocation?.trim();
    if (from && to) {
      return `${from} → ${to}`;
    }
  }

  if (type === 'accommodation') {
    const hotel = details.hotelName?.trim();
    const start = details.stayStartDate?.trim();
    const end = details.stayEndDate?.trim();
    if (hotel && start && end) return `${hotel} · ${start} → ${end}`;
    if (hotel) return hotel;
    if (start && end) return `${start} → ${end}`;
  }

  if (type === 'meal' || type === 'lunch' || type === 'dinner') {
    const period = details.mealPeriod;
    if (period) {
      return period.charAt(0).toUpperCase() + period.slice(1);
    }
  }

  return fallback.trim();
}
