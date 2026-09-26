import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton, Screen } from '@/components/ui-kit';
import { expenseTypeMeta } from '@/constants/expense-types';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { receiptCounts, tripTotal } from '@/storage/trips';
import { formatDateRange, formatMoney } from '@/utils/format';

export default function TripExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTrip } = useTrips();
  const trip = getTrip(id);
  const router = useRouter();
  const colors = useTheme();

  if (!trip) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={{ color: colors.text }}>Trip not found.</Text>
        </View>
      </Screen>
    );
  }

  const total = tripTotal(trip);
  const counts = receiptCounts(trip);
  const title = `${trip.from} → ${trip.to}`;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title,
          headerRight:
            trip.status === 'active'
              ? () => (
                  <Pressable onPress={() => router.push(`/trip/${trip.id}/review`)} hitSlop={10}>
                    <Text style={{ color: '#1A73E8', fontWeight: '600' }}>Review</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.dates, { color: colors.textSecondary }]}>
          {formatDateRange(trip.startDate, trip.endDate)}
        </Text>

        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>TOTAL</Text>
        <Text style={[styles.total, { color: colors.text }]}>{formatMoney(total)}</Text>

        <Text style={[styles.summary, { color: colors.textSecondary }]}>
          {counts.expenses} {counts.expenses === 1 ? 'expense' : 'expenses'}
          {'  ·  '}
          {counts.receipts} {counts.receipts === 1 ? 'receipt' : 'receipts'}
          {counts.missing > 0 ? `  ·  ${counts.missing} missing` : ''}
        </Text>

        {trip.status === 'active' && (
          <View style={styles.addWrap}>
            <PrimaryButton
              label="+ ADD EXPENSE"
              onPress={() => router.push(`/trip/${trip.id}/add`)}
            />
          </View>
        )}

        <View style={[styles.divider, { backgroundColor: colors.backgroundSelected }]} />

        {trip.expenses.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No expenses yet. Capture one after you pay for something.
          </Text>
        ) : (
          trip.expenses.map((expense) => {
            const meta = expenseTypeMeta(expense.type);
            const missing = expense.receiptStatus === 'missing';
            return (
              <View key={expense.id} style={styles.expenseRow}>
                <Text style={styles.icon}>{meta.icon}</Text>
                <View style={styles.expenseMid}>
                  <Text style={[styles.expenseLabel, { color: colors.text }]}>
                    {expense.description?.trim() || meta.label}
                  </Text>
                  <Text
                    style={{
                      color: missing ? '#C47F00' : colors.textSecondary,
                      fontSize: 13,
                      marginTop: 2,
                    }}>
                    {missing ? '⚠ Receipt missing' : '✓ Receipt attached'}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: colors.text }]}>
                  {formatMoney(expense.amount)}
                </Text>
                <Text style={{ marginLeft: 8, color: missing ? '#C47F00' : '#1B8A4A' }}>
                  {missing ? '⚠' : '✓'}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dates: {
    fontSize: 15,
    marginBottom: Spacing.four,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  total: {
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
  },
  summary: {
    marginTop: Spacing.two,
    fontSize: 14,
  },
  addWrap: {
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.four,
  },
  empty: {
    textAlign: 'center',
    fontSize: 15,
    paddingVertical: Spacing.five,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  icon: {
    fontSize: 22,
    width: 32,
  },
  expenseMid: {
    flex: 1,
    paddingRight: Spacing.two,
  },
  expenseLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
});
