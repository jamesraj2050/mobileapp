import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FieldInput,
  FieldLabel,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '@/components/ui-kit';
import { EXPENSE_TYPES } from '@/constants/expense-types';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import type { ExpenseType } from '@/types/expense';
import { todayIso } from '@/utils/format';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export default function AddExpenseScreen() {
  const params = useLocalSearchParams<{
    id: string;
  }>();
  const id = paramString(params.id);

  const { getTrip, addExpense, pendingReceipt, setPendingReceipt } = useTrips();
  const trip = getTrip(id);
  const router = useRouter();
  const colors = useTheme();

  const [type, setType] = useState<ExpenseType>('meal');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pendingReceipt || pendingReceipt.tripId !== id) return;
    setReceiptUri(pendingReceipt.receiptUri);
    if (pendingReceipt.amount) {
      setAmount(pendingReceipt.amount);
    }
    setPendingReceipt(null);
  }, [pendingReceipt, id, setPendingReceipt]);

  if (!trip) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={{ color: colors.text }}>Trip not found.</Text>
        </View>
      </Screen>
    );
  }

  if (trip.status === 'finished') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={{ color: colors.text }}>This trip is finished. Expenses are view-only.</Text>
        </View>
      </Screen>
    );
  }

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera needed', 'Allow camera access to scan receipts.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    router.push({
      pathname: '/trip/[id]/receipt',
      params: {
        id,
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType ?? 'image/jpeg',
        name: result.assets[0].fileName ?? 'receipt.jpg',
      },
    });
  };

  const openUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    router.push({
      pathname: '/trip/[id]/receipt',
      params: {
        id,
        uri: asset.uri,
        mimeType:
          asset.mimeType ??
          (asset.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
        name: asset.name ?? 'receipt',
      },
    });
  };

  const onSave = async () => {
    const parsed = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Amount required', 'Enter a valid amount greater than zero.');
      return;
    }

    setSaving(true);
    try {
      await addExpense(trip.id, {
        type,
        date,
        amount: Math.round(parsed * 100) / 100,
        description: description.trim(),
        receiptUri,
        receiptStatus: receiptUri ? 'attached' : 'missing',
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Add Expense' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FieldLabel>Type</FieldLabel>
        <View style={styles.typeGrid}>
          {EXPENSE_TYPES.map((option) => {
            const selected = option.value === type;
            return (
              <Pressable
                key={option.value}
                onPress={() => setType(option.value)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: selected
                      ? colors.backgroundSelected
                      : colors.backgroundElement,
                    borderColor: selected ? '#1A73E8' : colors.backgroundSelected,
                  },
                ]}>
                <Text style={styles.typeIcon}>{option.icon}</Text>
                <Text style={[styles.typeLabel, { color: colors.text }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <FieldLabel>Date</FieldLabel>
        <FieldInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />

        <FieldLabel>Amount</FieldLabel>
        <FieldInput
          value={amount}
          onChangeText={setAmount}
          placeholder="$ 0.00"
          keyboardType="decimal-pad"
        />

        <PrimaryButton label="📷 SCAN RECEIPT" onPress={openCamera} />

        <Text style={[styles.or, { color: colors.textSecondary }]}>OR</Text>

        <SecondaryButton label="Upload Receipt (Photo or PDF)" onPress={openUpload} />

        {receiptUri ? (
          <Text style={[styles.receiptOk, { color: '#1B8A4A' }]}>✓ Receipt attached</Text>
        ) : (
          <Text style={[styles.receiptWarn, { color: '#C47F00' }]}>
            ⚠ No receipt yet — you can save and add it later
          </Text>
        )}

        <FieldLabel>Description</FieldLabel>
        <FieldInput
          value={description}
          onChangeText={setDescription}
          placeholder="Lunch with client"
        />

        <View style={styles.spacer} />
        <PrimaryButton
          label={saving ? 'SAVING…' : 'SAVE EXPENSE'}
          onPress={onSave}
          disabled={saving}
        />
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
    padding: Spacing.four,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  typeIcon: {
    fontSize: 14,
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  or: {
    textAlign: 'center',
    marginVertical: Spacing.three,
    fontWeight: '600',
    letterSpacing: 1,
  },
  receiptOk: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    fontWeight: '600',
  },
  receiptWarn: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    fontSize: 13,
  },
  spacer: {
    height: Spacing.three,
  },
});
