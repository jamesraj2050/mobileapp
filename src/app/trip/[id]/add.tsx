import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import {
  FieldInput,
  FieldLabel,
  PrimaryButton,
  Screen,
} from '@/components/ui-kit';
import {
  EXPENSE_TYPES,
  MEAL_PERIODS,
  buildExpenseDescription,
  isTransportType,
} from '@/constants/expense-types';
import { Spacing, Brand, MaxContentWidth } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { extractReceiptFields, isPdfMimeOrUri, normalizeReceiptMime } from '@/services/api';
import type { ExpenseDetails, ExpenseType, MealPeriod } from '@/types/expense';
import { formatPlaceName, todayIso } from '@/utils/format';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export default function AddExpenseScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramString(params.id);

  const { getTrip, addExpense } = useTrips();
  const trip = getTrip(id);
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(Math.min(560, MaxContentWidth), width - Spacing.four * 2);

  const [type, setType] = useState<ExpenseType>('meal');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [stayStartDate, setStayStartDate] = useState(todayIso());
  const [stayEndDate, setStayEndDate] = useState(todayIso());
  const [hotelName, setHotelName] = useState('');
  const [mealPeriod, setMealPeriod] = useState<MealPeriod | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState('receipt');
  const [detectedAmount, setDetectedAmount] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractHint, setExtractHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [readProgress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!extracting) {
      readProgress.setValue(0);
      return;
    }

    readProgress.setValue(0);
    const animation = Animated.timing(readProgress, {
      toValue: 1,
      duration: 12_000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [extracting, readProgress]);

  const details: ExpenseDetails = useMemo(
    () => ({
      fromLocation: fromLocation.trim() || undefined,
      toLocation: toLocation.trim() || undefined,
      stayStartDate: stayStartDate.trim() || undefined,
      stayEndDate: stayEndDate.trim() || undefined,
      hotelName: hotelName.trim() || undefined,
      mealPeriod: mealPeriod ?? undefined,
    }),
    [fromLocation, toLocation, stayStartDate, stayEndDate, hotelName, mealPeriod]
  );

  const summary = buildExpenseDescription(type, details, notes);

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

  const applyExtraction = async (uri: string, mimeType: string) => {
    setExtracting(true);
    setExtractHint(null);
    try {
      const extraction = await extractReceiptFields({ localUri: uri, mimeType });
      const filled: string[] = [];
      const detectedType = extraction.type;

      if (detectedType) {
        setType(detectedType);
        filled.push('type');
      }

      const transport =
        detectedType != null
          ? isTransportType(detectedType)
          : Boolean(extraction.from || extraction.to);

      if (transport) {
        if (extraction.from) {
          setFromLocation(formatPlaceName(extraction.from));
          filled.push('from');
        }
        if (extraction.to) {
          setToLocation(formatPlaceName(extraction.to));
          filled.push('to');
        }
        if (!detectedType && (extraction.from || extraction.to)) {
          setType('flight');
          filled.push('type');
        }
      } else {
        // Clear route fields for meal / accommodation / parking / other
        setFromLocation('');
        setToLocation('');
        if (detectedType === 'accommodation' && extraction.merchant) {
          setHotelName(extraction.merchant);
          filled.push('hotel');
        }
        if (detectedType === 'meal' && extraction.merchant && !notes.trim()) {
          setNotes(extraction.merchant);
        }
        if (detectedType === 'parking' && extraction.merchant && !notes.trim()) {
          setNotes(extraction.merchant);
        }
      }

      if (extraction.date) {
        setDate(extraction.date);
        filled.push('date');
      }
      if (extraction.amount != null) {
        setDetectedAmount(extraction.amount);
        setAmount(extraction.amount.toFixed(2));
        filled.push('amount');
      }

      setExtractHint(
        filled.length > 0
          ? `Filled from receipt: ${filled.join(', ')}. Edit if needed.`
          : 'Could not read details from this receipt — enter manually.'
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      const short =
        detail && detail.length < 120
          ? detail
          : 'Could not read this receipt automatically';
      setExtractHint(`${short} — enter Type, Date and Amount manually.`);
    } finally {
      setExtracting(false);
    }
  };

  const attachReceipt = (uri: string, mimeType: string, name: string) => {
    const mime = normalizeReceiptMime(mimeType, name || uri);
    setReceiptUri(uri);
    setReceiptMime(mime);
    setReceiptName(name);
    setDetectedAmount(null);
    void applyExtraction(uri, mime);
  };

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
    attachReceipt(
      result.assets[0].uri,
      result.assets[0].mimeType ?? 'image/jpeg',
      result.assets[0].fileName ?? 'receipt.jpg'
    );
  };

  const openPhotoLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos needed', 'Allow photo library access to upload receipts.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;
    attachReceipt(
      result.assets[0].uri,
      result.assets[0].mimeType ?? 'image/jpeg',
      result.assets[0].fileName ?? 'receipt.jpg'
    );
  };

  const openDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    attachReceipt(
      asset.uri,
      normalizeReceiptMime(asset.mimeType, asset.name ?? asset.uri),
      asset.name ?? 'receipt'
    );
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
        description: summary,
        details,
        receiptUri,
        receiptStatus: receiptUri ? 'attached' : 'missing',
        localReceiptUri: receiptUri,
        receiptDetectedAmount: detectedAmount,
      });
      router.replace(`/trip/${trip.id}`);
    } finally {
      setSaving(false);
    }
  };

  const isPdf = isPdfMimeOrUri(receiptMime, receiptUri);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Add Expense' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.column, { width: columnWidth }]}>
          <BrandStrip
            title="Add Expense"
            onHome={() => router.navigate('/')}
          />
        <FieldLabel>Receipt</FieldLabel>
        {extracting ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Reading receipt"
            style={styles.readingProgress}>
            <Animated.View
              style={[
                styles.readingProgressFill,
                {
                  width: readProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
            <Text style={styles.readingProgressText}>READING RECEIPT…</Text>
          </View>
        ) : (
          <PrimaryButton label="📷 SCAN RECEIPT" onPress={() => void openCamera()} />
        )}
        <Text style={[styles.or, { color: colors.textSecondary }]}>OR</Text>
        <View style={styles.uploadRow}>
          <Pressable
            onPress={() => void openPhotoLibrary()}
            disabled={extracting}
            style={({ pressed }) => [
              styles.uploadBtn,
              {
                borderColor: colors.text,
                backgroundColor: colors.background,
              },
              extracting && styles.uploadDisabled,
              pressed && !extracting && styles.uploadPressed,
            ]}>
            <Text style={[styles.uploadHalfLabel, { color: colors.text }]}>Photo</Text>
            <Text style={[styles.uploadHalfHint, { color: colors.textSecondary }]}>
              Screenshot
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void openDocument()}
            disabled={extracting}
            style={({ pressed }) => [
              styles.uploadBtn,
              {
                borderColor: colors.text,
                backgroundColor: colors.background,
              },
              extracting && styles.uploadDisabled,
              pressed && !extracting && styles.uploadPressed,
            ]}>
            <Text style={[styles.uploadHalfLabel, { color: colors.text }]}>PDF / File</Text>
            <Text style={[styles.uploadHalfHint, { color: colors.textSecondary }]}>Document</Text>
          </Pressable>
        </View>

        {receiptUri ? (
          <View style={[styles.previewWrap, { backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.receiptOk, { color: '#1B8A4A' }]}>✓ Receipt attached</Text>
            {isPdf ? (
              <Text style={{ color: colors.text }} numberOfLines={2}>
                PDF · {receiptName}
              </Text>
            ) : (
              <Image source={{ uri: receiptUri }} style={styles.preview} contentFit="contain" />
            )}
            <Pressable
              onPress={() => {
                setReceiptUri(null);
                setDetectedAmount(null);
                setExtractHint(null);
              }}
              hitSlop={8}>
              <Text style={{ color: '#B00020', marginTop: 8, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.receiptWarn, { color: colors.textSecondary }]}>
            Scan or upload first — AI fills Type, Date, Amount (and From/To for travel).
          </Text>
        )}
        {extracting ? (
          <Text style={[styles.ocrHint, { color: colors.textSecondary }]}>
            Reading receipt with AI…
          </Text>
        ) : extractHint ? (
          <Text style={[styles.ocrHint, { color: colors.textSecondary }]}>{extractHint}</Text>
        ) : null}

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
                    borderColor: selected ? Brand.primary : colors.backgroundSelected,
                  },
                ]}>
                <Text style={styles.typeIcon}>{option.icon}</Text>
                <Text style={[styles.typeLabel, { color: colors.text }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {isTransportType(type) ? (
          <View style={styles.detailBlock}>
            <Text style={[styles.detailHeading, { color: colors.text }]}>Travel details</Text>
            <FieldLabel>From</FieldLabel>
            <FieldInput
              value={fromLocation}
              onChangeText={(text) => setFromLocation(formatPlaceName(text))}
              placeholder="eg:Brisbane"
              autoCapitalize="words"
            />
            <FieldLabel>To</FieldLabel>
            <FieldInput
              value={toLocation}
              onChangeText={(text) => setToLocation(formatPlaceName(text))}
              placeholder="eg:Perth"
              autoCapitalize="words"
            />
          </View>
        ) : null}

        {type === 'accommodation' ? (
          <View style={styles.detailBlock}>
            <Text style={[styles.detailHeading, { color: colors.text }]}>Stay details</Text>
            <FieldLabel>Hotel name</FieldLabel>
            <FieldInput
              value={hotelName}
              onChangeText={setHotelName}
              placeholder="Hotel / property name"
              autoCapitalize="words"
            />
            <FieldLabel>Check-in</FieldLabel>
            <FieldInput
              value={stayStartDate}
              onChangeText={setStayStartDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            <FieldLabel>Check-out</FieldLabel>
            <FieldInput
              value={stayEndDate}
              onChangeText={setStayEndDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
        ) : null}

        {type === 'meal' ? (
          <View style={styles.detailBlock}>
            <Text style={[styles.detailHeading, { color: colors.text }]}>Meal</Text>
            <View style={styles.typeGrid}>
              {MEAL_PERIODS.map((option) => {
                const selected = mealPeriod === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setMealPeriod(option.value)}
                    style={[
                      styles.typeChip,
                      {
                        backgroundColor: selected
                          ? colors.backgroundSelected
                          : colors.backgroundElement,
                        borderColor: selected ? Brand.primary : colors.backgroundSelected,
                      },
                    ]}>
                    <Text style={[styles.typeLabel, { color: colors.text }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <FieldLabel>Notes (optional)</FieldLabel>
            <FieldInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Restaurant / cafe name"
            />
          </View>
        ) : null}

        {type === 'parking' || type === 'other' ? (
          <View style={styles.detailBlock}>
            <FieldLabel>Notes (optional)</FieldLabel>
            <FieldInput
              value={notes}
              onChangeText={setNotes}
              placeholder={type === 'parking' ? 'Airport parking' : 'Short note'}
            />
          </View>
        ) : null}

        {summary ? (
          <Text style={[styles.summaryPreview, { color: colors.textSecondary }]}>
            Summary: {summary}
          </Text>
        ) : null}

        <FieldLabel>Date</FieldLabel>
        <FieldInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />

        <FieldLabel>Amount</FieldLabel>
        <FieldInput
          value={amount}
          onChangeText={setAmount}
          placeholder="$ 0.00"
          keyboardType="decimal-pad"
        />
        {detectedAmount != null ? (
          <Text style={[styles.ocrHint, { color: colors.textSecondary }]}>
            Suggested from receipt: ${detectedAmount.toFixed(2)} — edit if needed
          </Text>
        ) : null}

        <View style={styles.spacer} />
        <PrimaryButton
          label={saving ? 'SAVING…' : 'SAVE EXPENSE'}
          onPress={() => void onSave()}
          disabled={saving}
        />
        </View>
      </ScrollView>
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
  brandLogo: {
    marginBottom: Spacing.three,
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
  detailBlock: {
    marginBottom: Spacing.two,
  },
  detailHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: Spacing.two,
  },
  summaryPreview: {
    fontSize: 13,
    marginBottom: Spacing.three,
  },
  ocrHint: {
    fontSize: 13,
    marginTop: -Spacing.two,
    marginBottom: Spacing.three,
  },
  or: {
    textAlign: 'center',
    marginVertical: Spacing.three,
    fontWeight: '600',
    letterSpacing: 1,
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  uploadBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  uploadHalfLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  uploadHalfHint: {
    fontSize: 12,
  },
  uploadDisabled: {
    opacity: 0.45,
  },
  uploadPressed: {
    opacity: 0.75,
  },
  receiptOk: {
    fontWeight: '600',
    marginBottom: Spacing.two,
  },
  receiptWarn: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    fontSize: 13,
  },
  readingProgress: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readingProgressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Brand.primary,
  },
  readingProgressText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  previewWrap: {
    marginTop: Spacing.three,
    borderRadius: 12,
    padding: Spacing.three,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: 8,
  },
  spacer: {
    height: Spacing.three,
  },
});
