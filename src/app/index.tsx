import { Link, Stack, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { receiptCounts, tripTotal } from '@/storage/trips';
import type { Trip } from '@/types/expense';
import { formatDateRange, formatMoney } from '@/utils/format';

export default function MyTripsScreen() {
  const { trips, ready } = useTrips();
  const router = useRouter();
  const colors = useTheme();

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'My Trips',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/create-trip')}
              hitSlop={12}
              accessibilityLabel="Create trip">
              <Text style={[styles.plus, { color: colors.text }]}>+</Text>
            </Pressable>
          ),
        }}
      />

      {!ready ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : trips.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No trips yet</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Create a trip, then capture receipts as you travel.
          </Text>
          <Link href="/create-trip" asChild>
            <Pressable style={styles.emptyCta}>
              <Text style={styles.emptyCtaText}>Create Trip</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.backgroundSelected }]} />
          )}
          renderItem={({ item }) => (
            <TripRow trip={item} onPress={() => router.push(`/trip/${item.id}`)} />
          )}
        />
      )}
    </Screen>
  );
}

function TripRow({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const colors = useTheme();
  const total = tripTotal(trip);
  const { expenses } = receiptCounts(trip);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowTop}>
        <Text style={[styles.route, { color: colors.text }]}>
          {trip.from} → {trip.to}
        </Text>
        {trip.status === 'finished' ? (
          <Text style={[styles.badge, { color: colors.textSecondary }]}>FINISHED</Text>
        ) : (
          <Text style={[styles.badgeActive, { color: '#1A73E8' }]}>ACTIVE</Text>
        )}
      </View>
      <Text style={[styles.dates, { color: colors.textSecondary }]}>
        {formatDateRange(trip.startDate, trip.endDate)}
      </Text>
      <View style={styles.meta}>
        <Text style={[styles.total, { color: colors.text }]}>{formatMoney(total)}</Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {expenses} {expenses === 1 ? 'expense' : 'expenses'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  plus: {
    fontSize: 28,
    fontWeight: '400',
    paddingHorizontal: 4,
    lineHeight: 32,
  },
  list: {
    paddingVertical: Spacing.two,
  },
  row: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  route: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  badgeActive: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dates: {
    marginTop: 4,
    fontSize: 14,
  },
  meta: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  total: {
    fontSize: 20,
    fontWeight: '700',
  },
  count: {
    fontSize: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.four,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  emptyBody: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  emptyCta: {
    backgroundColor: '#1A73E8',
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
