import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
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
import { resolveReceiptViewUri } from '@/services/api';
import type { TaxWorkExpense } from '@/types/expense';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/format';
import {
  taxWorkDescription,
  taxWorkTypeLabel,
  taxYearTotals,
} from '@/utils/tax-year-statement';

export default function TaxWorkYearScreen() {
  const params = useLocalSearchParams<{ year: string }>();
  const year = Array.isArray(params.year) ? params.year[0] : params.year;
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const { session, signOut } = useAuth();
  const { expenses } = useTaxWork();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const yearExpenses = useMemo(
    () =>
      expenses
        .filter((expense) => expense.date.startsWith(`${year}-`))
        .sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date)
        ),
    [expenses, year]
  );
  const totals = useMemo(() => taxYearTotals(yearExpenses), [yearExpenses]);
  const contentWidth = Math.min(MaxContentWidth, width - Spacing.four * 2);

  useEffect(() => {
    if (!session) router.replace('/');
  }, [router, session]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };
  const downloadReceipt = async (expense: TaxWorkExpense) => {
    if (!expense.localReceiptUri && !expense.receiptUri && !expense.receiptKey) return;
    setDownloadingId(expense.id);
    try {
      const resolved = await resolveReceiptViewUri(expense);
      if (Platform.OS === 'web') {
        const response = await fetch(resolved.uri);
        const blob = await response.blob();
        const extension = resolved.isPdf
          ? 'pdf'
          : blob.type.includes('png')
            ? 'png'
            : blob.type.includes('webp')
              ? 'webp'
              : 'jpg';
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${taxWorkTypeLabel(expense).replace(/[^a-zA-Z0-9]+/g, '-')}-${expense.date}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(resolved.uri, {
          dialogTitle: 'Save receipt',
          mimeType: resolved.isPdf ? 'application/pdf' : 'image/*',
        });
      } else {
        await Linking.openURL(resolved.uri);
      }
    } catch (cause) {
      Alert.alert(
        'Could not download receipt',
        cause instanceof Error ? cause.message : 'Receipt is not available yet.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ width: contentWidth }}>
          <BrandStrip
            title={`Tax year: ${year || new Date().getFullYear()}`}
            onTitlePress={() => router.replace('/tax-work')}
            onHome={() => router.replace('/')}
            onBusinessTravel={() => router.replace('/')}
            onTaxWork={() => router.replace('/tax-work')}
            onSignOut={() => void handleSignOut()}
            actionLabel="Review"
            onAction={() => router.push(`/tax-work/${year}/review`)}
          />
          <View
            style={[
              styles.summary,
              {
                backgroundColor: colors.backgroundElement,
                borderColor: colors.backgroundSelected,
              },
            ]}>
            <View>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>RECEIPTS</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {yearExpenses.length}
              </Text>
            </View>
            <View style={styles.total}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>TOTAL</Text>
              {totals.length ? (
                totals.map(([currency, amount]) => (
                  <Text
                    key={currency}
                    style={[styles.currencyTotal, { color: colors.text }]}>
                    {formatCurrency(amount, currency)}
                  </Text>
                ))
              ) : (
                <Text style={[styles.currencyTotal, { color: colors.textSecondary }]}>
                  No expenses
                </Text>
              )}
            </View>
          </View>
          <PrimaryButton
            label="+  CAPTURE RECEIPT"
            onPress={() => router.push('/tax-work/capture')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
            <View style={[styles.table, { width: Math.max(contentWidth, 680) }]}>
              <View style={[styles.columnHeader, { borderColor: colors.backgroundSelected }]}>
                <Text style={[styles.headerDate, { color: colors.textSecondary }]}>DATE</Text>
                <Text style={[styles.headerType, { color: colors.textSecondary }]}>TYPE</Text>
                <Text style={[styles.headerDescription, { color: colors.textSecondary }]}>
                  DESCRIPTION
                </Text>
                <Text style={[styles.headerAmount, { color: colors.textSecondary }]}>AMOUNT</Text>
                <Text style={[styles.headerView, { color: colors.textSecondary }]}>VIEW</Text>
                <Text style={[styles.headerDownload, { color: colors.textSecondary }]}>
                  DOWNLOAD
                </Text>
              </View>
            {yearExpenses.map((expense) => (
              <View
                key={expense.id}
                style={[
                  styles.row,
                  { borderColor: colors.backgroundSelected },
                ]}>
                <Text style={[styles.date, { color: colors.textSecondary }]} numberOfLines={1}>
                  {formatDate(expense.date)}
                </Text>
                <Text style={[styles.type, { color: colors.text }]} numberOfLines={1}>
                  {taxWorkTypeLabel(expense)}
                </Text>
                <Text style={[styles.description, { color: colors.text }]} numberOfLines={1}>
                  {taxWorkDescription(expense)}
                </Text>
                <Text style={[styles.amount, { color: colors.text }]} numberOfLines={1}>
                  {formatCurrency(expense.amount, expense.currency)}
                </Text>
                <Pressable
                  onPress={() => router.push(`/tax-work/receipt/${expense.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel="View receipt"
                  style={({ pressed }) => [styles.viewButton, pressed && styles.pressed]}>
                  <Text style={styles.viewText}>View</Text>
                </Pressable>
                <Pressable
                  onPress={() => void downloadReceipt(expense)}
                  disabled={downloadingId === expense.id}
                  accessibilityRole="button"
                  accessibilityLabel="Download receipt"
                  style={({ pressed }) => [styles.downloadCell, pressed && styles.pressed]}>
                  <View style={styles.downloadButton}>
                    <Text style={styles.downloadText}>
                      {downloadingId === expense.id ? '…' : '↓'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
            {yearExpenses.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                No receipts recorded for {year}.
              </Text>
            ) : null}
            </View>
          </ScrollView>
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
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  total: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  summaryValue: { fontSize: 23, fontWeight: '800', marginTop: Spacing.one },
  currencyTotal: { fontSize: 17, fontWeight: '800', marginTop: Spacing.one },
  tableScroll: { paddingTop: Spacing.four },
  table: {},
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingBottom: Spacing.two,
  },
  headerDate: { width: 92, fontSize: 10, fontWeight: '800' },
  headerType: { width: 100, fontSize: 10, fontWeight: '800' },
  headerDescription: { flex: 1, fontSize: 10, fontWeight: '800' },
  headerAmount: { width: 130, textAlign: 'right', fontSize: 10, fontWeight: '800' },
  headerView: { width: 60, textAlign: 'center', fontSize: 10, fontWeight: '800' },
  headerDownload: { width: 64, textAlign: 'center', fontSize: 9, fontWeight: '800' },
  row: {
    borderBottomWidth: 1,
    paddingVertical: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
  },
  date: { width: 92, fontSize: 12 },
  type: { width: 100, paddingRight: Spacing.two, fontSize: 13, fontWeight: '700' },
  description: { flex: 1, paddingRight: Spacing.two, fontSize: 13, fontWeight: '700' },
  amount: { width: 130, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  viewButton: {
    width: 60,
    paddingVertical: 7,
    alignItems: 'center',
  },
  viewText: { color: '#00234E', fontSize: 11, fontWeight: '800' },
  downloadCell: { width: 64, alignItems: 'center' },
  downloadButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00234E',
  },
  downloadText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: Spacing.four },
  pressed: { opacity: 0.7 },
});
