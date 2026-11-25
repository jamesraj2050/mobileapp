import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { PrimaryButton, Screen } from '@/components/ui-kit';
import { buildExpenseDescription, expenseTypeMeta } from '@/constants/expense-types';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { resolveReceiptViewUri } from '@/services/api';
import { loadLocalTrips, receiptCounts, tripTotal } from '@/storage/local-store';
import type { Expense, Trip } from '@/types/expense';
import { formatDateShort, formatMoney, syncGlyph } from '@/utils/format';

export default function TripExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { getTrip, refresh } = useTrips();
  const fromContext = getTrip(id);
  const [fallbackTrip, setFallbackTrip] = useState<Trip | null>(null);
  const [loadingFallback, setLoadingFallback] = useState(true);
  const [receiptViewer, setReceiptViewer] = useState<{
    uri: string;
    isPdf: boolean;
    title: string;
  } | null>(null);
  const [openingReceipt, setOpeningReceipt] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(Math.min(560, MaxContentWidth), width - Spacing.four * 2);

  const trip = fromContext ?? fallbackTrip;

  useEffect(() => {
    if (fromContext || !id || !session?.user?.id) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const local = await loadLocalTrips(session.user.id);
        const found = local.find((t) => t.id === id) ?? null;
        if (!cancelled) {
          setFallbackTrip(found);
          if (found) {
            void refresh();
          }
        }
      } finally {
        if (!cancelled) setLoadingFallback(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromContext, id, session?.user?.id, refresh]);

  if (!trip && loadingFallback) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={{ color: colors.text }}>Trip not found.</Text>
          <Pressable onPress={() => router.replace('/')} style={{ marginTop: 16 }}>
            <Text style={{ color: Brand.primary, fontWeight: '600' }}>Back to My Trips</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const total = tripTotal(trip);
  const counts = receiptCounts(trip);
  const title = trip.name || `${trip.from} → ${trip.to}`;

  const hasReceipt = (expense: Expense) =>
    Boolean(expense.localReceiptUri || expense.receiptUri || expense.receiptKey);

  const openReceipt = async (expense: Expense) => {
    if (!hasReceipt(expense)) return;
    setOpeningReceipt(true);
    try {
      const resolved = await resolveReceiptViewUri({
        localReceiptUri: expense.localReceiptUri,
        receiptUri: expense.receiptUri,
        receiptKey: expense.receiptKey,
      });

      if (resolved.isPdf) {
        const canOpen = await Linking.canOpenURL(resolved.uri);
        if (canOpen || Platform.OS === 'web') {
          await Linking.openURL(resolved.uri);
        } else {
          Alert.alert('Receipt ready', 'PDF saved. Open it from your files app if needed.');
        }
        return;
      }

      setReceiptViewer({
        uri: resolved.uri,
        isPdf: false,
        title:
          buildExpenseDescription(expense.type, expense.details ?? {}, expense.description) ||
          expenseTypeMeta(expense.type).label,
      });
    } catch (e) {
      Alert.alert(
        'Could not open receipt',
        e instanceof Error ? e.message : 'Receipt is not available yet.'
      );
    } finally {
      setOpeningReceipt(false);
    }
  };

  const downloadReceipt = async (expense: Expense) => {
    if (!hasReceipt(expense)) return;
    setDownloadingReceiptId(expense.id);
    try {
      const resolved = await resolveReceiptViewUri({
        localReceiptUri: expense.localReceiptUri,
        receiptUri: expense.receiptUri,
        receiptKey: expense.receiptKey,
      });

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
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const expenseType = expenseTypeMeta(expense.type)
          .label.replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        link.href = downloadUrl;
        link.download = `${expenseType}-${expense.date}-${expense.id.slice(0, 8)}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
        return;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(resolved.uri, {
          dialogTitle: 'Save receipt',
          mimeType: resolved.isPdf ? 'application/pdf' : 'image/*',
        });
        return;
      }

      await Linking.openURL(resolved.uri);
    } catch (e) {
      Alert.alert(
        'Could not download receipt',
        e instanceof Error ? e.message : 'Receipt is not available yet.'
      );
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.column, { width: columnWidth }]}>
          <BrandStrip
            title={title}
            onHome={() => router.navigate('/')}
            actionLabel="Review"
            onAction={() => router.push(`/trip/${trip.id}/review`)}
          />
        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>TOTAL</Text>
        <Text style={[styles.total, { color: colors.text }]}>{formatMoney(total)}</Text>

        <Text style={[styles.summary, { color: colors.textSecondary }]}>
          {counts.expenses} {counts.expenses === 1 ? 'expense' : 'expenses'}
          {'  ·  '}
          {counts.receipts} {counts.receipts === 1 ? 'receipt' : 'receipts'}
          {trip.status === 'finished' ? '  ·  CLOSED' : ''}
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
            Tap ADD EXPENSE to start entry
          </Text>
        ) : (
          trip.expenses.map((expense) => {
            const meta = expenseTypeMeta(expense.type);
            const receiptAvailable = hasReceipt(expense);
            return (
              <View key={expense.id} style={styles.expenseRow}>
                <View style={styles.dateCol}>
                  <Text style={[styles.dateText, { color: colors.textSecondary }]}>
                    {formatDateShort(expense.date)}
                  </Text>
                </View>
                <Text style={styles.icon}>{meta.icon}</Text>
                <View style={styles.expenseMid}>
                  <Text style={[styles.expenseLabel, { color: colors.text }]} numberOfLines={2}>
                    {buildExpenseDescription(
                      expense.type,
                      expense.details ?? {},
                      expense.description
                    ) || meta.label}
                  </Text>
                  {expense.receiptUploadStatus === 'pending' ||
                  expense.receiptUploadStatus === 'failed' ||
                  expense.receiptUploadStatus === 'syncing' ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                      {expense.receiptUploadStatus === 'syncing'
                        ? 'Uploading receipt…'
                        : expense.receiptUploadStatus === 'failed'
                          ? 'Receipt upload will retry'
                          : 'Receipt upload pending'}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.amount, { color: colors.text }]}>
                  {formatMoney(expense.amount)}
                </Text>
                {receiptAvailable ? (
                  <Pressable
                    onPress={() => void openReceipt(expense)}
                    disabled={openingReceipt}
                    hitSlop={8}
                    accessibilityLabel="View receipt"
                    style={styles.receiptBtn}>
                    <Text style={styles.receiptIcon}>🧾</Text>
                  </Pressable>
                ) : (
                  <View style={styles.receiptBtnPlaceholder} />
                )}
                <Text
                  style={{
                    marginLeft: 4,
                    width: 16,
                    textAlign: 'center',
                    color:
                      expense.syncStatus === 'synced'
                        ? '#1B8A4A'
                        : expense.syncStatus === 'syncing'
                          ? Brand.primary
                          : '#C47F00',
                  }}>
                  {syncGlyph(expense.syncStatus)}
                </Text>
                {receiptAvailable ? (
                  <Pressable
                    onPress={() => void downloadReceipt(expense)}
                    disabled={downloadingReceiptId === expense.id}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Download receipt"
                    style={({ pressed }) => [
                      styles.receiptDownloadBtn,
                      pressed && styles.receiptDownloadBtnPressed,
                    ]}>
                    <Text style={styles.receiptDownloadIcon}>
                      {downloadingReceiptId === expense.id ? '…' : '↓'}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.receiptDownloadPlaceholder} />
                )}
              </View>
            );
          })
        )}
        </View>
      </ScrollView>

      <Modal
        visible={!!receiptViewer}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setReceiptViewer(null)}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
              {receiptViewer?.title ?? 'Receipt'}
            </Text>
            <Pressable onPress={() => setReceiptViewer(null)} hitSlop={12}>
              <Text style={{ color: Brand.primary, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>
          {receiptViewer ? (
            <Image
              source={{ uri: receiptViewer.uri }}
              style={styles.modalImage}
              contentFit="contain"
            />
          ) : null}
          {receiptViewer ? (
            <Pressable
              onPress={() => void Linking.openURL(receiptViewer.uri)}
              style={styles.downloadBtn}>
              <Text style={styles.downloadText}>Open / Download</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    alignItems: 'center',
  },
  column: {
    maxWidth: Math.min(560, MaxContentWidth),
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    gap: 6,
  },
  dateCol: {
    width: 52,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
  },
  icon: {
    fontSize: 20,
    width: 28,
  },
  expenseMid: {
    flex: 1,
    paddingRight: 4,
  },
  expenseLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  amount: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'right',
  },
  receiptBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptBtnPlaceholder: {
    width: 32,
  },
  receiptIcon: {
    fontSize: 20,
  },
  receiptDownloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptDownloadBtnPressed: {
    backgroundColor: '#E8F0FA',
  },
  receiptDownloadIcon: {
    color: Brand.primary,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 21,
  },
  receiptDownloadPlaceholder: {
    width: 28,
  },
  modal: {
    flex: 1,
    paddingTop: Spacing.five,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.three,
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    marginRight: Spacing.three,
  },
  modalImage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#111',
  },
  downloadBtn: {
    margin: Spacing.four,
    backgroundColor: Brand.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  downloadText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
