import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { PrimaryButton, Screen } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTaxWork } from '@/context/tax-work-context';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency } from '@/utils/currency';

export default function TaxWorkReceiptsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const { session, signOut } = useAuth();
  const {
    expenses,
    hiddenYears,
    ready,
    syncing,
    error,
    hideYear,
    restoreYear,
    permanentlyDeleteYear,
  } = useTaxWork();
  const [deletedYearsOpen, setDeletedYearsOpen] = useState(false);
  const [busyYear, setBusyYear] = useState<number | null>(null);

  useEffect(() => {
    if (!session) router.replace('/');
  }, [router, session]);

  const years = useMemo(() => {
    const grouped = new Map<string, { count: number; totals: Map<string, number> }>();
    grouped.set(String(new Date().getFullYear()), { count: 0, totals: new Map() });
    for (const expense of expenses) {
      const year = expense.date.slice(0, 4);
      const current = grouped.get(year) ?? { count: 0, totals: new Map() };
      current.count += 1;
      current.totals.set(
        expense.currency,
        (current.totals.get(expense.currency) ?? 0) + expense.amount
      );
      grouped.set(year, current);
    }
    return [...grouped.entries()]
      .filter(([year]) => !hiddenYears.includes(Number(year)))
      .sort(([a], [b]) => b.localeCompare(a));
  }, [expenses, hiddenYears]);

  const contentWidth = Math.min(MaxContentWidth, width - Spacing.four * 2);
  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };
  const runYearAction = async (
    year: number,
    action: () => Promise<void>,
    failureTitle: string
  ) => {
    setBusyYear(year);
    try {
      await action();
    } catch (cause) {
      Alert.alert(
        failureTitle,
        cause instanceof Error ? cause.message : 'Please try again.'
      );
    } finally {
      setBusyYear(null);
    }
  };
  const confirmHideYear = (year: number) => {
    const message = `Remove ${year} from this screen? You can restore it from Deleted Years.`;
    const remove = () => void runYearAction(year, () => hideYear(year), 'Could not remove year');
    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) remove();
      return;
    }
    Alert.alert('Remove year?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', onPress: remove },
    ]);
  };
  const confirmPermanentDelete = (year: number) => {
    const message = `Permanently delete ${year} and all its expenses and receipts? This cannot be undone.`;
    const remove = () =>
      void runYearAction(
        year,
        () => permanentlyDeleteYear(year),
        'Could not permanently delete year'
      );
    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) remove();
      return;
    }
    Alert.alert('Permanently delete year?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete permanently', style: 'destructive', onPress: remove },
    ]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ width: contentWidth }}>
          <BrandStrip
            title="Select Tax Year"
            onHome={() => router.replace('/')}
            onBusinessTravel={() => router.replace('/')}
            onTaxWork={() => undefined}
            onSignOut={() => void handleSignOut()}
          />
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            Keep your work and tax-related receipts organized by year.
          </Text>
          <PrimaryButton
            label="+  CAPTURE RECEIPT"
            onPress={() => router.push('/tax-work/capture')}
          />
          {syncing ? (
            <Text style={[styles.sync, { color: colors.textSecondary }]}>Syncing…</Text>
          ) : null}
          {!ready ? (
            <ActivityIndicator style={styles.loading} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : years.length === 0 && hiddenYears.length === 0 ? (
            <View style={[styles.empty, { borderColor: colors.backgroundSelected }]}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No receipts yet</Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                Capture a receipt to start your yearly record.
              </Text>
            </View>
          ) : (
            <View style={styles.years}>
              {years.map(([year, summary]) => (
                <View
                  key={year}
                  style={[
                    styles.yearCard,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.backgroundSelected,
                    },
                  ]}>
                  <Pressable
                    onPress={() => router.push(`/tax-work/${year}`)}
                    style={({ pressed }) => [styles.yearMain, pressed && styles.pressed]}>
                    <View>
                      <Text style={[styles.year, { color: colors.text }]}>{year}</Text>
                      <Text style={[styles.count, { color: colors.textSecondary }]}>
                        {summary.count} {summary.count === 1 ? 'receipt' : 'receipts'}
                      </Text>
                    </View>
                    <View style={styles.totalBlock}>
                      <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>TOTAL</Text>
                      {[...summary.totals.entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([currency, amount]) => (
                          <Text key={currency} style={[styles.total, { color: colors.text }]}>
                            {formatCurrency(amount, currency)}
                          </Text>
                        ))}
                      {summary.totals.size === 0 ? (
                        <Text style={[styles.total, { color: colors.text }]}>No expenses</Text>
                      ) : null}
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmHideYear(Number(year))}
                    disabled={busyYear === Number(year)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${year}`}
                    style={({ pressed }) => [
                      styles.yearDelete,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.yearDeleteIcon}>
                      {busyYear === Number(year) ? '…' : '🗑'}
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() => setDeletedYearsOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.deletedToggle,
                  { borderColor: colors.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.deletedToggleText, { color: colors.text }]}>
                  Deleted Years ({hiddenYears.length}) {deletedYearsOpen ? '▴' : '▾'}
                </Text>
              </Pressable>
              {deletedYearsOpen ? (
                <View
                  style={[
                    styles.deletedPanel,
                    {
                      borderColor: colors.backgroundSelected,
                      backgroundColor: colors.backgroundElement,
                    },
                  ]}>
                  {hiddenYears.length === 0 ? (
                    <Text style={{ color: colors.textSecondary }}>No deleted years.</Text>
                  ) : (
                    hiddenYears.map((year) => (
                      <View
                        key={year}
                        style={[styles.deletedRow, { borderColor: colors.backgroundSelected }]}>
                        <Text style={[styles.deletedYear, { color: colors.text }]}>{year}</Text>
                        <Pressable
                          onPress={() =>
                            void runYearAction(
                              year,
                              () => restoreYear(year),
                              'Could not restore year'
                            )
                          }
                          disabled={busyYear === year}
                          style={({ pressed }) => [
                            styles.restoreButton,
                            pressed && styles.pressed,
                          ]}>
                          <Text style={styles.restoreText}>Restore</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => confirmPermanentDelete(year)}
                          disabled={busyYear === year}
                          style={({ pressed }) => [
                            styles.permanentButton,
                            pressed && styles.pressed,
                          ]}>
                          <Text style={styles.permanentText}>Delete permanently</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  intro: { fontSize: 15, lineHeight: 21, marginBottom: Spacing.three },
  sync: { fontSize: 12, textAlign: 'right', marginTop: Spacing.two },
  loading: { marginTop: Spacing.five },
  error: { color: '#B00020', marginTop: Spacing.four },
  empty: {
    marginTop: Spacing.four,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.four,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyBody: { fontSize: 14, marginTop: Spacing.two, textAlign: 'center' },
  years: { gap: Spacing.three, marginTop: Spacing.four },
  yearCard: {
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  yearMain: {
    flex: 1,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearDelete: {
    width: 58,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCE8EA',
  },
  yearDeleteIcon: { fontSize: 20 },
  year: { fontSize: 24, fontWeight: '800' },
  count: { marginTop: Spacing.one, fontSize: 14 },
  totalBlock: { alignItems: 'flex-end' },
  totalLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  total: { marginTop: Spacing.one, fontSize: 19, fontWeight: '700' },
  deletedToggle: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    alignItems: 'center',
  },
  deletedToggleText: { fontSize: 15, fontWeight: '700' },
  deletedPanel: { borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  deletedRow: {
    minHeight: 52,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  deletedYear: { flex: 1, fontSize: 18, fontWeight: '800' },
  restoreButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: '#E4F5EA',
  },
  restoreText: { color: '#16723A', fontWeight: '800' },
  permanentButton: { paddingHorizontal: 10, paddingVertical: 9 },
  permanentText: { color: '#B00020', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.75 },
});

