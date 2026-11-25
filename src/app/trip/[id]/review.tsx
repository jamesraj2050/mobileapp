import * as Print from 'expo-print';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { PrimaryButton, Screen, SecondaryButton } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { receiptCounts, tripTotal } from '@/storage/local-store';
import {
  buildExpenseStatementHtml,
  expenseStatementFileName,
} from '@/utils/expense-statement';
import { formatDateRange, formatMoney } from '@/utils/format';

function printReportOnWeb(html: string): void {
  const reportWindow = globalThis.window?.open('', '_blank');
  if (!reportWindow) {
    throw new Error('Allow pop-ups to download the report');
  }
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 150);
}

export default function ReviewTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTrip, finishTrip } = useTrips();
  const { signOut } = useAuth();
  const trip = getTrip(id);
  const router = useRouter();
  const colors = useTheme();
  const [finishing, setFinishing] = useState(false);
  const [statementBusy, setStatementBusy] = useState(false);
  const [statementUri, setStatementUri] = useState<string | null>(null);

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

  const statementHtml = () => buildExpenseStatementHtml(trip);

  const ensureStatementPdf = async (): Promise<string> => {
    if (statementUri) return statementUri;
    const result = await Print.printToFileAsync({ html: statementHtml() });
    const FileSystem = await import('expo-file-system/legacy');
    const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!base) return result.uri;
    const namedUri = `${base}${expenseStatementFileName(trip)}.pdf`;
    await FileSystem.deleteAsync(namedUri, { idempotent: true }).catch(() => undefined);
    await FileSystem.copyAsync({ from: result.uri, to: namedUri });
    setStatementUri(namedUri);
    return namedUri;
  };

  const downloadStatement = async () => {
    setStatementBusy(true);
    try {
      if (Platform.OS === 'web') {
        printReportOnWeb(statementHtml());
        return;
      }
      const uri = await ensureStatementPdf();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: 'Save trip report',
          mimeType: 'application/pdf',
          UTI: '.pdf',
        });
      }
    } catch (error) {
      Alert.alert(
        'Could not create report',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setStatementBusy(false);
    }
  };

  const shareStatement = async () => {
    setStatementBusy(true);
    try {
      if (Platform.OS === 'web') {
        const file = new File([statementHtml()], `${expenseStatementFileName(trip)}.html`, {
          type: 'text/html',
        });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({
            title: expenseStatementFileName(trip),
            text: `${trip.name || `${trip.from} to ${trip.to}`} · ${formatMoney(total)}`,
            files: [file],
          });
        } else {
          Alert.alert('Sharing unavailable', 'Use Download Report and save it as a PDF.');
        }
        return;
      }

      const uri = await ensureStatementPdf();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: 'Share trip report',
          mimeType: 'application/pdf',
          UTI: '.pdf',
        });
      }
    } catch (error) {
      Alert.alert(
        'Could not share report',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setStatementBusy(false);
    }
  };

  const finishAndCreateStatement = async () => {
    setFinishing(true);
    try {
      await finishTrip(trip.id);
      if (Platform.OS !== 'web') {
        await ensureStatementPdf();
      }
    } catch (error) {
      Alert.alert(
        'Could not finish trip',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setFinishing(false);
    }
  };

  const onFinish = () => {
    const message =
      'This closes the trip and creates a trip report. You can still view and share it.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Finish trip?\n\n${message}`)) {
        void finishAndCreateStatement();
      }
      return;
    }

    Alert.alert(
      'Finish trip?',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish Trip',
          style: 'default',
          onPress: () => void finishAndCreateStatement(),
        },
      ]
    );
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <BrandStrip title="Review Trip" onHome={() => router.navigate('/')} />
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
            <PrimaryButton
              label={finishing ? 'FINISHING…' : 'FINISH TRIP'}
              onPress={onFinish}
              disabled={finishing}
            />
          ) : (
            <>
              <Text style={[styles.finished, { color: '#1B8A4A' }]}>
                ✓ Trip finished. Trip report ready.
              </Text>
              <View style={styles.finalActionRow}>
                <Pressable
                  onPress={() => router.replace('/')}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.finalActionButton,
                    styles.closeButton,
                    pressed && styles.finalActionPressed,
                  ]}>
                  <Text style={styles.closeButtonText}>CLOSE TRIP</Text>
                </Pressable>
                <Pressable
                  onPress={() => void downloadStatement()}
                  disabled={statementBusy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.finalActionButton,
                    styles.downloadButton,
                    pressed && styles.finalActionPressed,
                    statementBusy && styles.finalActionDisabled,
                  ]}>
                  <Text style={styles.downloadButtonText}>
                    {statementBusy ? 'PREPARING…' : 'DOWNLOAD REPORT'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void shareStatement()}
                  disabled={statementBusy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.finalActionButton,
                    styles.shareButton,
                    pressed && styles.finalActionPressed,
                    statementBusy && styles.finalActionDisabled,
                  ]}>
                  <Text style={styles.shareButtonText}>SHARE REPORT</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSignOut()}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.finalActionButton,
                    styles.signOutButton,
                    pressed && styles.signOutPressed,
                  ]}>
                  <Text style={styles.signOutText}>SIGN OUT</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>
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
    flexGrow: 1,
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
    marginBottom: Spacing.three,
    fontWeight: '700',
  },
  finalActionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  finalActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finalActionPressed: {
    opacity: 0.72,
  },
  finalActionDisabled: {
    opacity: 0.45,
  },
  closeButton: {
    borderColor: '#111111',
    backgroundColor: '#111111',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  downloadButton: {
    borderColor: '#00234E',
    backgroundColor: '#00234E',
  },
  downloadButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  shareButton: {
    borderColor: '#00234E',
  },
  shareButtonText: {
    color: '#00234E',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#B00020',
  },
  signOutPressed: {
    backgroundColor: '#FBEAEC',
  },
  signOutText: {
    color: '#B00020',
    fontSize: 15,
    fontWeight: '700',
  },
});
