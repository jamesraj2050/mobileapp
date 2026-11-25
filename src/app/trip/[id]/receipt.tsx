import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import { extractReceiptFields, isPdfMimeOrUri, normalizeReceiptMime } from '@/services/api';

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
  const { saveReceiptExpense } = useTrips();

  const isPdf = isPdfMimeOrUri(mimeType, uri);
  const [amount, setAmount] = useState('');
  const [detectedAmount, setDetectedAmount] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractHint, setExtractHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    (async () => {
      setExtracting(true);
      setExtractHint(null);
      try {
        const extraction = await extractReceiptFields({
          localUri: uri,
          mimeType: normalizeReceiptMime(mimeType, uri),
        });
        if (cancelled) return;
        if (extraction.amount != null) {
          setDetectedAmount(extraction.amount);
          setAmount(extraction.amount.toFixed(2));
          setExtractHint(`Suggested $${extraction.amount.toFixed(2)} — edit if needed.`);
        } else {
          setExtractHint('Could not read amount — enter it manually.');
        }
      } catch {
        if (!cancelled) {
          setExtractHint('AI read unavailable — enter amount manually.');
        }
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, mimeType]);

  const onSave = async () => {
    if (!uri) {
      Alert.alert('Missing receipt', 'No receipt file to save.');
      return;
    }

    const parsed = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Amount required', 'Enter the amount (AI is only a suggestion).');
      return;
    }

    setSaving(true);
    try {
      await saveReceiptExpense({
        tripId: id,
        localUri: uri,
        amount: Math.round(parsed * 100) / 100,
        detectedAmount,
      });
      router.replace(`/trip/${id}`);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save expense locally.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Receipt captured ✓' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FieldLabel>Amount</FieldLabel>
        <FieldInput
          value={amount ? (amount.startsWith('$') ? amount : `$ ${amount}`) : ''}
          onChangeText={(text) => setAmount(text.replace(/^\$\s?/, ''))}
          placeholder={extracting ? 'Detecting… or type amount' : 'Enter amount'}
          keyboardType="decimal-pad"
          style={styles.amountInput}
          editable
        />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {extracting
            ? 'Reading receipt with AI…'
            : extractHint ?? 'Enter amount manually. You can save immediately.'}
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
          label={saving ? 'SAVING…' : 'SAVE'}
          onPress={() => void onSave()}
          disabled={saving}
        />
        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          Saves on this device instantly. Cloud sync runs in the background.
        </Text>
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
  footer: {
    marginTop: Spacing.three,
    textAlign: 'center',
    fontSize: 13,
  },
});
