import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { CurrencyPicker } from '@/components/currency-picker';
import { FieldInput, FieldLabel, PrimaryButton, Screen, SecondaryButton } from '@/components/ui-kit';
import { expenseTypeMeta } from '@/constants/expense-types';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTaxWork } from '@/context/tax-work-context';
import { useTheme } from '@/hooks/use-theme';
import { resolveReceiptViewUri } from '@/services/api';
import type { TaxWorkOtherType } from '@/types/expense';
import { normalizeCurrency } from '@/utils/currency';
import { parseDateInput } from '@/utils/format';

export default function TaxWorkReceiptDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const { getExpense, updateExpense, deleteExpense } = useTaxWork();
  const expense = getExpense(id);
  const [date, setDate] = useState(expense?.date ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [currency, setCurrency] = useState(normalizeCurrency(expense?.currency));
  const [description, setDescription] = useState(expense?.description ?? '');
  const [otherType, setOtherType] = useState<TaxWorkOtherType | null>(
    expense?.otherType ?? null
  );
  const [otherDescription, setOtherDescription] = useState(
    expense?.otherDescription ?? ''
  );
  const [viewUri, setViewUri] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const contentWidth = Math.min(Math.min(560, MaxContentWidth), width - Spacing.four * 2);

  useEffect(() => {
    if (!expense) return;
    let cancelled = false;
    resolveReceiptViewUri(expense)
      .then((result) => {
        if (!cancelled) {
          setViewUri(result.uri);
          setIsPdf(result.isPdf);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setViewError(cause instanceof Error ? cause.message : 'Could not open receipt');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expense]);

  if (!expense) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={{ color: colors.text }}>Receipt not found.</Text>
        </View>
      </Screen>
    );
  }

  const save = async () => {
    const normalizedDate = parseDateInput(date);
    const parsedAmount = Number(amount.replace(/[^0-9.]/g, ''));
    if (!normalizedDate) {
      Alert.alert('Check date', 'Enter a valid date.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Check amount', 'Enter a valid amount greater than zero.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Enter a short description.');
      return;
    }
    if (expense.type === 'other' && otherType === 'custom' && !otherDescription.trim()) {
      Alert.alert('Description required', 'Enter a short custom description.');
      return;
    }
    setSaving(true);
    try {
      await updateExpense(expense.id, {
        date: normalizedDate,
        amount: Math.round(parsedAmount * 100) / 100,
        currency,
        description: description.trim(),
        otherType: expense.type === 'other' ? otherType : null,
        otherDescription:
          expense.type === 'other' ? otherDescription.trim() : '',
      });
      router.replace(`/tax-work/${normalizedDate.slice(0, 4)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await deleteExpense(expense.id);
    router.replace(`/tax-work/${expense.date.slice(0, 4)}`);
  };
  const confirmDelete = () => {
    const message = 'Delete this record and its stored receipt? This cannot be undone.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) void remove();
      return;
    }
    Alert.alert('Delete receipt?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ]);
  };
  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={{ width: contentWidth }}>
          <BrandStrip
            title="Receipt"
            onHome={() => router.replace('/')}
            onBusinessTravel={() => router.replace('/')}
            onTaxWork={() => router.replace('/tax-work')}
            onSignOut={() => void handleSignOut()}
          />
          <Text style={[styles.type, { color: colors.text }]}>
            {expense.type === 'other'
              ? expense.otherType === 'house_rent'
                ? 'House Rent Receipt'
                : 'Custom'
              : expenseTypeMeta(expense.type).label}
          </Text>
          <View
            style={[
              styles.receipt,
              {
                backgroundColor: colors.backgroundElement,
                borderColor: colors.backgroundSelected,
              },
            ]}>
            {viewUri && !isPdf ? (
              <Image source={{ uri: viewUri }} style={styles.image} contentFit="contain" />
            ) : viewUri && isPdf ? (
              <SecondaryButton
                label="Open PDF Receipt"
                onPress={() => void Linking.openURL(viewUri)}
              />
            ) : (
              <Text style={{ color: viewError ? '#B00020' : colors.textSecondary }}>
                {viewError ?? 'Loading receipt…'}
              </Text>
            )}
          </View>

          <FieldLabel>Date</FieldLabel>
          <FieldInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          <View style={styles.amountRow}>
            <View style={styles.currencyField}>
              <FieldLabel>Currency</FieldLabel>
              <CurrencyPicker value={currency} onChange={setCurrency} />
            </View>
            <View style={styles.amountField}>
              <FieldLabel>Amount</FieldLabel>
              <FieldInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            </View>
          </View>
          <FieldLabel>Description</FieldLabel>
          <FieldInput
            value={description}
            onChangeText={setDescription}
            placeholder="Expense description"
          />
          {expense.type === 'other' ? (
            <>
              <FieldLabel>Other type</FieldLabel>
              <View style={styles.otherRow}>
                {([
                  ['house_rent', 'House Rent Receipt'],
                  ['custom', 'Custom'],
                ] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setOtherType(value)}
                    style={[
                      styles.otherButton,
                      {
                        borderColor:
                          otherType === value ? Brand.primary : colors.backgroundSelected,
                        backgroundColor:
                          otherType === value ? Brand.primary : colors.backgroundElement,
                      },
                    ]}>
                    <Text style={{ color: otherType === value ? '#fff' : colors.text }}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {otherType === 'custom' ? (
                <FieldInput
                  value={otherDescription}
                  onChangeText={setOtherDescription}
                  placeholder="Custom description"
                />
              ) : null}
            </>
          ) : null}
          <PrimaryButton
            label={saving ? 'SAVING…' : 'SAVE CHANGES'}
            onPress={() => void save()}
            disabled={saving}
          />
          <Pressable onPress={confirmDelete} style={styles.deleteButton}>
            <Text style={styles.deleteText}>Delete receipt</Text>
          </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  type: { fontSize: 22, fontWeight: '800', marginBottom: Spacing.three },
  receipt: {
    minHeight: 180,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    justifyContent: 'center',
    marginBottom: Spacing.four,
  },
  image: { width: '100%', height: 300 },
  amountRow: { flexDirection: 'row', gap: Spacing.two },
  currencyField: { width: 125 },
  amountField: { flex: 1 },
  otherRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  otherButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    alignItems: 'center',
  },
  deleteButton: { padding: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  deleteText: { color: '#B00020', fontWeight: '700' },
});

