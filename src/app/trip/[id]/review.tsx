import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, Screen, SecondaryButton } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { receiptCounts, tripTotal } from '@/storage/trips';
import { formatDateRange, formatMoney } from '@/utils/format';

export default function ReviewTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTrip, finishTrip } = useTrips();
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

  const onFinish = () => {
    Alert.alert(
      'Finish trip?',
      'This marks the trip as finished. Expenses stay on your device — nothing is submitted to accounting.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish Trip',
          style: 'default',
          onPress: async () => {
            await finishTrip(trip.id);
            router.replace(`/trip/${trip.id}`);
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Review Trip' }} />
      <View style={styles.content}>
        <Text style={[styles.route, { color: colors.text }]}>
          {trip.from} → {trip.to}
        </Text>
        <Text style={[styles.dates, { color: colors.textSecondary }]}>
          {formatDateRange(trip.startDate, trip.endDate)}
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          Total expenses
        </Text>
        <Text style={[styles.total, { color: colors.text }]}>{formatMoney(total)}</Text>

        <View style={styles.stats}>
          <Stat label="Expenses" value={String(counts.expenses)} />
          <Stat label="Receipts" value={String(counts.receipts)} />
          <Stat label="Missing receipts" value={String(counts.missing)} />
        </View>

        {counts.missing > 0 ? (
          <Text style={styles.warning}>
            ⚠ {counts.missing === 1 ? 'One receipt is missing' : `${counts.missing} receipts are missing`}
          </Text>
        ) : (
          <Text style={[styles.ok, { color: '#1B8A4A' }]}>✓ All receipts attached</Text>
        )}

        <View style={styles.actions}>
          <SecondaryButton
            label="VIEW EXPENSES"
            onPress={() => router.back()}
          />
          <View style={styles.gap} />
          {trip.status === 'active' ? (
            <PrimaryButton label="FINISH TRIP" onPress={onFinish} />
          ) : (
            <Text style={[styles.finished, { color: colors.textSecondary }]}>
              This trip is already finished.
            </Text>
          )}
        </View>
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useTheme();
  return (
    <View style={styles.statRow}>
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: Spacing.four,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  route: {
    fontSize: 22,
    fontWeight: '800',
  },
  dates: {
    marginTop: 4,
    fontSize: 15,
    marginBottom: Spacing.five,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  total: {
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
    marginBottom: Spacing.four,
  },
  stats: {
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  warning: {
    color: '#C47F00',
    fontWeight: '600',
    fontSize: 15,
    marginBottom: Spacing.four,
  },
  ok: {
    fontWeight: '600',
    fontSize: 15,
    marginBottom: Spacing.four,
  },
  actions: {
    marginTop: 'auto',
    paddingBottom: Spacing.four,
  },
  gap: {
    height: Spacing.three,
  },
  finished: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
