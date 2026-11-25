import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  /** Fixed height override. If omitted, scales for phone vs browser. */
  height?: number;
  /** Larger top-of-screen treatment on welcome / hero surfaces. */
  hero?: boolean;
  /** Force white logo for black backgrounds (e.g. brand strip). */
  onDark?: boolean;
  style?: ViewStyle;
};

const LOGO_DARK = require('../../assets/images/ark-logo.png');
const LOGO_LIGHT_ON_DARK = require('../../assets/images/ark-logo-white.jpg');

/** Ark wordmark: navy on light UI, white/teal variant on dark (black) backgrounds. */
export function ArkLogo({ height, hero = false, onDark = false, style }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const scheme = useColorScheme();
  const useWhiteLogo = onDark || scheme === 'dark';
  const isWide = windowWidth >= 768;

  const resolvedHeight =
    height ??
    (hero
      ? isWide
        ? Math.min(140, Math.round(windowWidth * 0.12))
        : 72
      : isWide
        ? 72
        : 48);

  const resolvedWidth = Math.min(
    Math.round(resolvedHeight * 3.4),
    isWide && hero ? 480 : windowWidth - 48
  );

  return (
    <View
      style={[
        styles.wrap,
        hero && styles.heroWrap,
        // White plate only behind the navy logo on light UI.
        !useWhiteLogo && styles.lightPlate,
        style,
      ]}>
      <Image
        source={useWhiteLogo ? LOGO_LIGHT_ON_DARK : LOGO_DARK}
        style={{ width: resolvedWidth, height: resolvedHeight }}
        contentFit="contain"
        accessibilityLabel="Ark Consulting Group"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightPlate: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  heroWrap: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
});
