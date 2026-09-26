import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { suggestReceiptAmount } from '@/utils/format';

export default function ReceiptConfirmScreen() {
  const { id, uri } = useLocalSearchParams<{ id: string; uri: string }>();
  const router = useRouter();
  const colors = useTheme();

  const suggested = useMemo(() => suggestReceiptAmount(), []);
  const [amount, setAmount] = useState(suggested.toFixed(2));

  const onConfirm = () => {
    const parsed = Number(amount.replace(/[^0-9.]/g, ''));
    const confirmed = Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : '';
    router.replace({
      pathname: '/trip/[id]/add',
      params: {
        id,
        amount: confirmed,
        receiptUri: uri,
      },
    });
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
          Amount can be edited. OCR suggests — you confirm.
        </Text>

        {uri ? (
          <View style={[styles.previewWrap, { backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
              Receipt Preview
            </Text>
            <Image source={{ uri }} style={styles.preview} contentFit="contain" />
          </View>
        ) : null}

        <PrimaryButton label="CONFIRM" onPress={onConfirm} />
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
});
