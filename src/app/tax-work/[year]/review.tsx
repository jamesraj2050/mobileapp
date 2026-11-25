import * as Print from 'expo-print';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { PrimaryButton, Screen, SecondaryButton } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTaxWork } from '@/context/tax-work-context';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/format';
import {
  buildTaxYearStatementHtml,
  sortTaxYearExpenses,
  taxWorkDescription,
  taxWorkTypeLabel,
  taxYearStatementFileName,
  taxYearTotals,
} from '@/utils/tax-year-statement';

function printReportOnWeb(html: string): void {
  const reportWindow = globalThis.window?.open('', '_blank');
  if (!reportWindow) {
    throw new Error('Allow pop-ups to generate the report');
  }
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 150);
}

function downloadHtmlOnWeb(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function TaxWorkYearReviewScreen() {
  const params = useLocalSearchParams<{ year: string }>();
  const year = Array.isArray(params.year) ? params.year[0] : params.year;
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const { session, signOut } = useAuth();
  const { expenses } = useTaxWork();
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [statementUri, setStatementUri] = useState<string | null>(null);
  const yearExpenses = useMemo(
    () =>
      sortTaxYearExpenses(
        expenses.filter((expense) => expense.date.startsWith(`${year}-`))
      ),
    [expenses, year]
  );
  const totals = useMemo(() => taxYearTotals(yearExpenses), [yearExpenses]);
  const contentWidth = Math.min(MaxContentWidth, width - Spacing.four * 2);
  const fileName = taxYearStatementFileName(year || String(new Date().getFullYear()));
  const statementHtml = () =>
    buildTaxYearStatementHtml(year || String(new Date().getFullYear()), yearExpenses);

  useEffect(() => {
    if (!session) router.replace('/');
  }, [router, session]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  const ensureStatementPdf = async (): Promise<string> => {
    if (statementUri) return statementUri;
    const result = await Print.printToFileAsync({ html: statementHtml() });
    const FileSystem = await import('expo-file-system/legacy');
    const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!base) return result.uri;
    const namedUri = `${base}${fileName}.pdf`;
    await FileSystem.deleteAsync(namedUri, { idempotent: true }).catch(() => undefined);
    await FileSystem.copyAsync({ from: result.uri, to: namedUri });
    setStatementUri(namedUri);
    return namedUri;
  };

  const generateReport = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        printReportOnWeb(statementHtml());
        setGenerated(true);
        return;
      }
      await ensureStatementPdf();
      setGenerated(true);
    } catch (error) {
      Alert.alert(
        'Could not generate report',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        downloadHtmlOnWeb(statementHtml(), fileName);
        setGenerated(true);
        return;
      }
      const uri = await ensureStatementPdf();
      setGenerated(true);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: 'Save tax year report',
          mimeType: 'application/pdf',
          UTI: '.pdf',
        });
      }
    } catch (error) {
      Alert.alert(
        'Could not download report',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ width: contentWidth }}>
          <BrandStrip
            title={`Review ${year || new Date().getFullYear()}`}
            onHome={() => router.replace('/')}
            onBusinessTravel={() => router.replace('/')}
            onTaxWork={() => router.replace('/tax-work')}
            onSignOut={() => void handleSignOut()}
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

          <View style={styles.actions}>
            <PrimaryButton
              label={busy ? 'PREPARING…' : generated ? 'REGENERATE REPORT' : 'GENERATE REPORT'}
              onPress={() => void generateReport()}
              disabled={busy || yearExpenses.length === 0}
            />
            <View style={styles.gap} />
            <SecondaryButton
              label={busy ? 'PREPARING…' : 'DOWNLOAD REPORT'}
              onPress={() => void downloadReport()}
              disabled={busy || yearExpenses.length === 0}
            />
          </View>
          {generated ? (
            <Text style={[styles.ready, { color: '#1B8A4A' }]}>
              ✓ Tax year report is ready.
            </Text>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
            <View style={[styles.table, { width: Math.max(contentWidth, 560) }]}>
              <View style={[styles.columnHeader, { borderColor: colors.backgroundSelected }]}>
                <Text style={[styles.headerDate, { color: colors.textSecondary }]}>DATE</Text>
                <Text style={[styles.headerType, { color: colors.textSecondary }]}>TYPE</Text>
                <Text style={[styles.headerDescription, { color: colors.textSecondary }]}>
                  DESCRIPTION
                </Text>
                <Text style={[styles.headerAmount, { color: colors.textSecondary }]}>AMOUNT</Text>
              </View>
              {yearExpenses.map((expense) => (
                <View
                  key={expense.id}
                  style={[styles.row, { borderColor: colors.backgroundSelected }]}>
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
  actions: { marginBottom: Spacing.two },
  gap: { height: Spacing.two },
  ready: {
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: Spacing.two,
  },
  tableScroll: { paddingTop: Spacing.three },
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
  empty: { textAlign: 'center', marginTop: Spacing.four },
});
