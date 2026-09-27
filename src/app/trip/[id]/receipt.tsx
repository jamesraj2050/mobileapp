import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { isPdfMimeOrUri, uploadReceiptToR2 } from '@/services/receipt-upload';
import { suggestReceiptAmount } from '@/utils/format';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export default function ReceiptConfirmScreen() {
  const params = useLocalSearchParams<{
    id: string;
    uri: string;
    mimeType?: string;
    name?: string;
  }>();
  const id = paramString(params.id);
  const uri = paramString(params.uri);
  const mimeType = paramString(params.mimeType);
  const fileName = paramString(params.name) || 'receipt';
  const router = useRouter();
  const colors = useTheme();
  const { setPendingReceipt } = useTrips();

  const isPdf = isPdfMimeOrUri(mimeType, uri);
  const suggested = useMemo(() => suggestReceiptAmount(), []);
  const [amount, setAmount] = useState(suggested.toFixed(2));
  const [uploading, setUploading] = useState(false);

  const onConfirm = async () => {
    if (!uri) {
      Alert.alert('Missing receipt', 'No receipt file to upload.');
      return;
    }

    const parsed = Number(amount.replace(/[^0-9.]/g, ''));
    const confirmed = Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : '';

    setUploading(true);
    try {
      const remoteUrl = await uploadReceiptToR2(
        uri,
        mimeType || (isPdf ? 'application/pdf' : 'image/jpeg')
      );
      setPendingReceipt({
        tripId: id,
        receiptUri: remoteUrl,
        amount: confirmed,
      });
      router.back();
    } catch (e) {
      Alert.alert(
        'Upload failed',
        e instanceof Error ? e.message : 'Could not upload receipt to Cloudflare R2.'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Receipt captured ✓' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FieldLabel>Detected Amount</FieldLabel>
        <FieldInput
          value={amount.startsWith('$') ? amount : `$ ${amount}`}
          onChangeText={(text) => setAmount(text.replace(/^\$\s?/, ''))}
          keyboardType="decimal-pad"
          style={styles.amountInput}
        />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Amount can be edited. OCR suggests — you confirm. Confirm also uploads the receipt to
          Cloudflare R2.
        </Text>

        {uri ? (
          <View style={[styles.previewWrap, { backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
              Receipt Preview
            </Text>
            {isPdf ? (
              <View style={styles.pdfBox}>
                <Text style={[styles.pdfIcon, { color: colors.text }]}>PDF</Text>
                <Text style={[styles.pdfName, { color: colors.text }]} numberOfLines={2}>
                  {fileName}
                </Text>
              </View>
            ) : (
              <Image source={{ uri }} style={styles.preview} contentFit="contain" />
            )}
          </View>
        ) : null}

        <PrimaryButton
          label={uploading ? 'UPLOADING…' : 'CONFIRM'}
          onPress={onConfirm}
          disabled={uploading}
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
  amountInput: {
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 16,
  },
  hint: {
    marginTop: -Spacing.two,
    marginBottom: Spacing.four,
    fontSize: 14,
  },
  previewWrap: {
    borderRadius: 12,
    padding: Spacing.three,
    marginBottom: Spacing.four,
    overflow: 'hidden',
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.two,
    textTransform: 'uppercase',
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: 8,
  },
  pdfBox: {
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  pdfIcon: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  pdfName: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
});
