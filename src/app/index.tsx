import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ArkLogo } from '@/components/ark-logo';
import { BrandStrip } from '@/components/brand-strip';
import { PrimaryButton, Screen } from '@/components/ui-kit';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { receiptCounts, tripTotal } from '@/storage/local-store';
import type { Trip } from '@/types/expense';
import { formatDate, formatMoney, syncGlyph } from '@/utils/format';

const TRIPS_COLUMN = Math.min(560, MaxContentWidth);

export default function MyTripsScreen() {
  const { session, ready: authReady, signingIn, error: authError, signIn, signOut, configured, redirectUri } =
    useAuth();
  const { trips, ready, error, deleteTrip } = useTrips();
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(TRIPS_COLUMN, width - Spacing.four * 2);
  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };
  const confirmDeleteTrip = (trip: Trip) => {
    const tripLabel = trip.name || `${trip.from} to ${trip.to}`;
    const message = `Delete "${tripLabel}" and all its expenses and receipts? This cannot be undone.`;
    const remove = async () => {
      setDeletingTripId(trip.id);
      try {
        await deleteTrip(trip.id);
      } catch (deleteError) {
        Alert.alert(
          'Could not delete trip',
          deleteError instanceof Error ? deleteError.message : 'Please try again.'
        );
      } finally {
        setDeletingTripId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) {
        void remove();
      }
      return;
    }

    Alert.alert('Delete trip?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ]);
  };

  if (!authReady) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Travel Expenses', headerShown: false }} />
        <View style={styles.welcome}>
          <View style={styles.welcomeLogo}>
            <ArkLogo hero />
          </View>
          <View style={styles.welcomeBody}>
            <Text style={[styles.brand, { color: colors.text }]}>Travel Expenses</Text>
            <Text style={[styles.tagline, { color: colors.textSecondary }]}>
              Capture a receipt in about 15 seconds — even offline. Cloud sync happens in the
              background.
            </Text>
            {!configured ? (
              <Text style={[styles.emptyBody, { color: '#C47F00' }]}>
                Add Google OAuth client IDs to .env (see .env.example), then restart with npx expo
                start --clear
              </Text>
            ) : null}
            {authError ? (
              <Text style={[styles.emptyBody, { color: '#B00020' }]}>{authError}</Text>
            ) : null}
            <PrimaryButton
              label={signingIn ? 'SIGNING IN…' : 'Continue with Google'}
              onPress={() => void signIn()}
              disabled={signingIn || !configured}
            />
            {configured ? (
              <Text style={[styles.redirectHint, { color: colors.textSecondary }]}>
                If Allow gets stuck, open this app in Chrome/Safari (not Cursor’s browser).{'\n'}
                Google Cloud → Web client → Authorized redirect URIs must include:{'\n'}
                {redirectUri}
              </Text>
            ) : null}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {!ready ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load trips</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{error}</Text>
        </View>
      ) : trips.length === 0 ? (
        <View style={styles.centered}>
          <View style={[styles.column, { width: columnWidth }]}>
            <BrandStrip
              title="My Trips"
              onHome={() => router.navigate('/')}
              onSignOut={() => void handleSignOut()}
              onBusinessTravel={() => router.replace('/')}
              onTaxWork={() => router.push('/tax-work')}
              onAdd={() => router.push('/create-trip')}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No trips yet</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              Create a trip, then add expenses as you travel.
            </Text>
            <Link href="/create-trip" asChild>
              <Pressable style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>Create Trip</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={[styles.column, { width: columnWidth, alignSelf: 'center' }]}>
              <BrandStrip
                title="My Trips"
                onHome={() => router.navigate('/')}
                onSignOut={() => void handleSignOut()}
                onBusinessTravel={() => router.replace('/')}
                onTaxWork={() => router.push('/tax-work')}
                onAdd={() => router.push('/create-trip')}
              />
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.column, { width: columnWidth, alignSelf: 'center' }]}>
              <TripRow
                trip={item}
                onPress={() => router.push(`/trip/${item.id}`)}
                onDelete={() => confirmDeleteTrip(item)}
                deleting={deletingTripId === item.id}
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

function TripRow({
  trip,
  onPress,
  onDelete,
  deleting,
}: {
  trip: Trip;
  onPress: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const colors = useTheme();
  const total = tripTotal(trip);
  const { expenses } = receiptCounts(trip);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.backgroundElement,
          borderColor: colors.backgroundSelected,
        },
      ]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.rowContent, pressed && styles.pressed]}>
        <View style={styles.rowTop}>
          <Text style={[styles.route, { color: colors.text }]} numberOfLines={2}>
            {trip.from} → {trip.to}
          </Text>
          <View style={styles.statusBlock}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {syncGlyph(trip.syncStatus)}
            </Text>
            {trip.status === 'finished' ? (
              <Text style={[styles.badge, { color: colors.textSecondary }]}>FINISHED</Text>
            ) : (
              <Text style={[styles.badgeActive, { color: Brand.primary }]}>ACTIVE</Text>
            )}
          </View>
        </View>
        <Text style={[styles.dates, { color: colors.textSecondary }]}>
          Start : {formatDate(trip.startDate)}
          {'  ·  '}
          {expenses} {expenses === 1 ? 'expense' : 'expenses'}
        </Text>
        <Text style={[styles.total, { color: colors.text }]}>{formatMoney(total)}</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={deleting}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${trip.name || `${trip.from} to ${trip.to}`}`}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && styles.deleteButtonPressed,
        ]}>
        <Text style={styles.deleteIcon}>{deleting ? '…' : '🗑'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  welcomeLogo: {
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  welcomeBody: {
    width: '100%',
    maxWidth: 420,
    gap: Spacing.three,
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  column: {
    maxWidth: TRIPS_COLUMN,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  row: {
    position: 'relative',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: Spacing.two,
  },
  rowContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.85,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  route: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  statusBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  deleteButton: {
    position: 'absolute',
    zIndex: 1,
    right: Spacing.three,
    bottom: Spacing.three,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D7A0AA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonPressed: {
    backgroundColor: '#FBEAEC',
  },
  deleteIcon: {
    fontSize: 16,
    lineHeight: 19,
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
    fontSize: 14,
  },
  total: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: Spacing.one,
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
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  emptyBody: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  redirectHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  emptyCta: {
    backgroundColor: Brand.primary,
    paddingHorizontal: Spacing.four,
    paddingVertical: 12,
    borderRadius: 12,
    alignSelf: 'center',
  },
  emptyCtaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
