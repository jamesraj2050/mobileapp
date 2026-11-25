import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { CurrencyPicker } from '@/components/currency-picker';
import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { isTransportType, TAX_WORK_EXPENSE_TYPES } from '@/constants/expense-types';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTaxWork } from '@/context/tax-work-context';
import { useTheme } from '@/hooks/use-theme';
import {
  extractReceiptFields,
  isPdfMimeOrUri,
  normalizeReceiptMime,
} from '@/services/api';
import type { ExpenseType, TaxWorkOtherType } from '@/types/expense';
import { deviceCurrency } from '@/utils/currency';
import { formatPlaceName, parseDateInput, todayIso } from '@/utils/format';

export default function CaptureTaxWorkReceiptScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const { addExpense, updateExpense } = useTaxWork();
  const [type, setType] = useState<ExpenseType | null>(null);
  const [description, setDescription] = useState('');
  const [descriptionManuallyEdited, setDescriptionManuallyEdited] = useState(false);
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [otherType, setOtherType] = useState<TaxWorkOtherType>('custom');
  const [otherDescription, setOtherDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(deviceCurrency);
  const [detectedAmount, setDetectedAmount] = useState<number | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState('receipt');
  const [extracting, setExtracting] = useState(false);
  const [extractHint, setExtractHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const columnWidth = Math.min(Math.min(560, MaxContentWidth), width - Spacing.four * 2);

  useEffect(() => {
    if (!extracting) {
      progress.setValue(0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 12_000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [extracting, progress]);

  const applyExtraction = async (uri: string, mimeType: string, expenseId: string) => {
    setExtracting(true);
    setExtractHint(null);
    try {
      const extraction = await extractReceiptFields({ localUri: uri, mimeType });
      const filled: string[] = [];
      const supportedDetectedType =
        extraction.type &&
        TAX_WORK_EXPENSE_TYPES.some((option) => option.value === extraction.type)
          ? extraction.type
          : null;
      const detectedType =
        supportedDetectedType ??
        (extraction.from || extraction.to
          ? type && isTransportType(type)
            ? type
            : 'flight'
          : type ?? 'other');
      const detectedFrom = extraction.from ? formatPlaceName(extraction.from) : '';
      const detectedTo = extraction.to ? formatPlaceName(extraction.to) : '';
      const automaticDescription = isTransportType(detectedType)
        ? [detectedFrom, detectedTo].filter(Boolean).join(' - ')
        : detectedType === 'meal'
          ? 'Meal'
          : '';
      const nextDescription =
        !descriptionManuallyEdited && automaticDescription
          ? automaticDescription
          : description;
      setType(detectedType);
      setFromLocation(detectedFrom);
      setToLocation(detectedTo);
      setDescription(nextDescription);
      filled.push('type');
      if (automaticDescription) filled.push('description');
      if (extraction.date) {
        setDate(extraction.date);
        filled.push('date');
      }
      if (extraction.amount != null) {
        setDetectedAmount(extraction.amount);
        setAmount(extraction.amount.toFixed(2));
        filled.push('amount');
      }
      await updateExpense(expenseId, {
        type: detectedType,
        description: nextDescription.trim(),
        otherType: detectedType === 'other' ? otherType : null,
        otherDescription: detectedType === 'other' ? otherDescription : '',
        date: extraction.date ?? date,
        amount: extraction.amount ?? 0,
        receiptDetectedAmount: extraction.amount,
      });
      setExtractHint(
        filled.length
          ? `Filled ${filled.join(' and ')} from the receipt. Check and edit if needed.`
          : 'AI could not identify the receipt details. Enter them manually.'
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not read receipt';
      setExtractHint(`${message} — enter the date and amount manually.`);
    } finally {
      setExtracting(false);
    }
  };

  const selectType = (nextType: ExpenseType) => {
    setType(nextType);
    if (descriptionManuallyEdited) return;
    if (nextType === 'meal') {
      setDescription('Meal');
      return;
    }
    if (isTransportType(nextType)) {
      setDescription([fromLocation.trim(), toLocation.trim()].filter(Boolean).join(' - '));
      return;
    }
    setDescription('');
  };

  const updateRouteDescription = (from: string, to: string) => {
    if (!descriptionManuallyEdited) {
      setDescription([from.trim(), to.trim()].filter(Boolean).join(' - '));
    }
  };

  const attachReceipt = async (uri: string, mimeType: string, name: string) => {
    if (autoSaving || draftId) return;
    const normalized = normalizeReceiptMime(mimeType, name || uri);
    setReceiptUri(uri);
    setReceiptMime(normalized);
    setReceiptName(name);
    setDetectedAmount(null);
    setAutoSaving(true);
    try {
      const draftType = type ?? 'other';
      const draft = await addExpense({
        type: draftType,
        description: description.trim(),
        currency,
        otherType: draftType === 'other' ? otherType : null,
        otherDescription: draftType === 'other' ? otherDescription : '',
        date,
        amount: 0,
        receiptDetectedAmount: null,
        localReceiptUri: uri,
      });
      setDraftId(draft.id);
      setExtractHint('Receipt saved. Reading type, date and amount with AI…');
      await applyExtraction(uri, normalized, draft.id);
    } catch (cause) {
      Alert.alert(
        'Could not save receipt',
        cause instanceof Error ? cause.message : 'Please try again.'
      );
    } finally {
      setAutoSaving(false);
    }
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera needed', 'Allow camera access to capture receipts.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await attachReceipt(
      asset.uri,
      asset.mimeType ?? 'image/jpeg',
      asset.fileName ?? 'receipt.jpg'
    );
  };

  const openPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos needed', 'Allow photo access to upload receipts.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await attachReceipt(
      asset.uri,
      asset.mimeType ?? 'image/jpeg',
      asset.fileName ?? 'receipt.jpg'
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
    await attachReceipt(
      asset.uri,
      normalizeReceiptMime(asset.mimeType, asset.name),
      asset.name
    );
  };

  const save = async () => {
    if (!receiptUri || !draftId) {
      Alert.alert('Receipt required', 'Take a photo or choose a receipt file first.');
      return;
    }
    const normalizedDate = parseDateInput(date);
    if (!normalizedDate) {
      Alert.alert('Check date', 'Enter a valid date such as 2026-09-30 or 30-09-2026.');
      return;
    }
    const parsedAmount = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Amount required', 'Enter a valid amount greater than zero.');
      return;
    }
    if (!type) {
      Alert.alert('Type required', 'Select the expense type.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Enter a short description for this expense.');
      return;
    }
    if (type === 'other' && otherType === 'custom' && !otherDescription.trim()) {
      Alert.alert('Description required', 'Enter a short custom description.');
      return;
    }
    setSaving(true);
    try {
      await updateExpense(draftId, {
        type,
        description: description.trim(),
        currency,
        otherType: type === 'other' ? otherType : null,
        otherDescription: type === 'other' ? otherDescription : '',
        date: normalizedDate,
        amount: Math.round(parsedAmount * 100) / 100,
        receiptDetectedAmount: detectedAmount,
      });
      router.replace(`/tax-work/${normalizedDate.slice(0, 4)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };
  const isPdf = isPdfMimeOrUri(receiptMime, receiptUri);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={{ width: columnWidth }}>
          <BrandStrip
            title="Capture Tax Receipt"
            onHome={() => router.replace('/')}
            onBusinessTravel={() => router.replace('/')}
            onTaxWork={() => router.replace('/tax-work')}
            onSignOut={() => void handleSignOut()}
          />
          <FieldLabel>Type</FieldLabel>
          <View style={styles.typeGrid}>
            {TAX_WORK_EXPENSE_TYPES.map((option) => {
              const selected = type === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => selectType(option.value)}
                  style={[
                    styles.typeChip,
                    {
                      borderColor: selected ? Brand.primary : colors.backgroundSelected,
                      backgroundColor: selected ? Brand.primary : colors.backgroundElement,
                    },
                  ]}>
                  <Text style={{ color: selected ? '#ffffff' : colors.text, fontWeight: '700' }}>
                    {option.icon} {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {type === 'other' ? (
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
                  placeholder="eg: Professional membership"
                />
              ) : null}
            </>
          ) : null}

          {type && isTransportType(type) ? (
            <View style={styles.routeRow}>
              <View style={styles.routeField}>
                <FieldLabel>From</FieldLabel>
                <FieldInput
                  value={fromLocation}
                  onChangeText={(value) => {
                    const formatted = formatPlaceName(value);
                    setFromLocation(formatted);
                    updateRouteDescription(formatted, toLocation);
                  }}
                  placeholder="eg: Brisbane Station"
                />
              </View>
              <View style={styles.routeField}>
                <FieldLabel>To</FieldLabel>
                <FieldInput
                  value={toLocation}
                  onChangeText={(value) => {
                    const formatted = formatPlaceName(value);
                    setToLocation(formatted);
                    updateRouteDescription(fromLocation, formatted);
                  }}
                  placeholder="eg: Perth Station"
                />
              </View>
            </View>
          ) : null}

          <FieldLabel>Description</FieldLabel>
          <FieldInput
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              setDescriptionManuallyEdited(true);
            }}
            placeholder="eg: Client lunch"
          />

          <FieldLabel>Receipt</FieldLabel>
          {extracting || autoSaving ? (
            <View style={styles.progress}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
              <Text style={styles.progressText}>
                {extracting ? 'READING RECEIPT…' : 'SAVING RECEIPT…'}
              </Text>
            </View>
          ) : draftId ? (
            <View style={styles.savedBanner}>
              <Text style={styles.savedBannerText}>✓ RECEIPT SAVED AUTOMATICALLY</Text>
            </View>
          ) : (
            <PrimaryButton label="📷  TAKE PHOTO" onPress={() => void openCamera()} />
          )}
          {!draftId ? (
            <View style={styles.uploadRow}>
              <Pressable
                disabled={extracting || autoSaving}
                onPress={() => void openPhoto()}
                style={[styles.uploadButton, { borderColor: colors.text }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Photo</Text>
              </Pressable>
              <Pressable
                disabled={extracting || autoSaving}
                onPress={() => void openDocument()}
                style={[styles.uploadButton, { borderColor: colors.text }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>PDF / File</Text>
              </Pressable>
            </View>
          ) : null}

          {receiptUri ? (
            <View style={[styles.preview, { backgroundColor: colors.backgroundElement }]}>
              {isPdf ? (
                <Text style={{ color: colors.text }}>PDF · {receiptName}</Text>
              ) : (
                <Image source={{ uri: receiptUri }} style={styles.previewImage} contentFit="contain" />
              )}
              <Text style={styles.attached}>✓ Receipt attached</Text>
            </View>
          ) : null}
          {extractHint ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{extractHint}</Text>
          ) : null}

          <View style={styles.dateSection}>
            <FieldLabel>Date</FieldLabel>
            <FieldInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.amountRow}>
            <View style={styles.currencyField}>
              <FieldLabel>Currency</FieldLabel>
              <CurrencyPicker value={currency} onChange={setCurrency} />
            </View>
            <View style={styles.amountField}>
              <FieldLabel>Amount</FieldLabel>
              <FieldInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <PrimaryButton
            label={saving ? 'SAVING…' : 'DONE'}
            onPress={() => void save()}
            disabled={saving || extracting || autoSaving}
          />
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
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  otherRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  routeRow: { flexDirection: 'row', gap: Spacing.two },
  routeField: { flex: 1 },
  amountRow: { flexDirection: 'row', gap: Spacing.two },
  currencyField: { width: 125 },
  amountField: { flex: 1 },
  otherButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    alignItems: 'center',
  },
  uploadRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  uploadButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  progress: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#DDE4EC',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: undefined,
    backgroundColor: Brand.primary,
  },
  progressText: { color: '#ffffff', textAlign: 'center', fontWeight: '800' },
  savedBanner: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#E4F5EA',
  },
  savedBannerText: { color: '#16723A', fontWeight: '800' },
  preview: { marginTop: Spacing.three, borderRadius: 12, padding: Spacing.three },
  previewImage: { width: '100%', height: 180 },
  attached: { color: '#1B8A4A', fontWeight: '700', marginTop: Spacing.two },
  hint: { fontSize: 13, lineHeight: 18, marginVertical: Spacing.three },
  dateSection: { marginTop: Spacing.two },
});

