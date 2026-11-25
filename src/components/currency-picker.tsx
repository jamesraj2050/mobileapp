import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from '@/utils/currency';

export function CurrencyPicker({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (currency: CurrencyCode) => void;
}) {
  const colors = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Currency ${value}. Select currency`}
        style={({ pressed }) => [
          styles.input,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: colors.backgroundSelected,
          },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.inputText, { color: colors.text }]}>{value}</Text>
        <Text style={{ color: colors.textSecondary }}>▾</Text>
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.dialog, { backgroundColor: colors.background }]}
            onPress={(event) => event.stopPropagation()}>
            <Text style={[styles.title, { color: colors.text }]}>Select currency</Text>
            <FlatList
              data={SUPPORTED_CURRENCIES}
              keyExtractor={(item) => item}
              numColumns={3}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    {
                      backgroundColor:
                        item === value ? Brand.primary : colors.backgroundElement,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.optionText,
                      { color: item === value ? '#ffffff' : colors.text },
                    ]}>
                    {item}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable onPress={() => setOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  inputText: { fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: 16,
    padding: Spacing.three,
  },
  title: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
  list: { gap: Spacing.two },
  option: {
    flex: 1,
    margin: Spacing.one,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  optionText: { fontWeight: '800' },
  close: { alignItems: 'center', padding: Spacing.three },
  closeText: { color: Brand.primary, fontWeight: '800' },
});

