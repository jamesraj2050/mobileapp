import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { ArkLogo } from '@/components/ark-logo';
import { Spacing } from '@/constants/theme';

type Props = {
  title?: string;
  onTitlePress?: () => void;
  onHome?: () => void;
  onSignOut?: () => void;
  onBusinessTravel?: () => void;
  onTaxWork?: () => void;
  onAdd?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
};

/** Shared black page bar with white Ark branding and an optional add action. */
export function BrandStrip({
  title = 'Travel Expenses',
  onTitlePress,
  onHome,
  onSignOut,
  onBusinessTravel,
  onTaxWork,
  onAdd,
  actionLabel,
  onAction,
  style,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState({ left: 16, top: 64 });
  const homeButtonRef = useRef<View>(null);
  const [menuAnimation] = useState(() => new Animated.Value(0));
  const hasNavigation = Boolean(onHome);

  useEffect(() => {
    if (!menuOpen) {
      menuAnimation.setValue(0);
      return;
    }
    Animated.spring(menuAnimation, {
      toValue: 1,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [menuAnimation, menuOpen]);

  const handleHomePress = () => {
    if (onSignOut) {
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      homeButtonRef.current?.measureInWindow((x, y, _width, height) => {
        setMenuAnchor({ left: x, top: y + height + 8 });
        setMenuOpen(true);
      });
      return;
    }
    onHome?.();
  };

  return (
    <View style={[styles.strip, style]}>
      {onHome ? (
        <View ref={homeButtonRef} collapsable={false}>
          <Pressable
            onPress={handleHomePress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={onSignOut ? 'Open account menu' : 'Go home'}
            style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}>
            <Text style={styles.homeLabel}>⌂</Text>
          </Pressable>
        </View>
      ) : null}
      {menuOpen && onSignOut ? (
        <Modal
          transparent
          visible
          animationType="none"
          statusBarTranslucent
          onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} />
          <Animated.View
            style={[
              styles.menu,
              {
                left: menuAnchor.left,
                top: menuAnchor.top,
                opacity: menuAnimation,
                transform: [
                  {
                    translateY: menuAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-8, 0],
                    }),
                  },
                  {
                    scale: menuAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.96, 1],
                    }),
                  },
                ],
              },
            ]}>
            {onBusinessTravel ? (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onBusinessTravel();
                }}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
                <Text style={styles.menuText}>Business Travel</Text>
              </Pressable>
            ) : null}
            {onTaxWork ? (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onTaxWork();
                }}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
                <Text style={styles.menuText}>Tax / Work Receipts</Text>
              </Pressable>
            ) : null}
            {onBusinessTravel || onTaxWork ? <View style={styles.menuDivider} /> : null}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                onSignOut();
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </Animated.View>
        </Modal>
      ) : null}
      <ArkLogo height={hasNavigation ? 28 : 40} onDark />
      {onTitlePress ? (
        <Pressable
          onPress={onTitlePress}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Select another year`}
          style={({ pressed }) => [styles.titleButton, pressed && styles.pressed]}>
          <Text style={styles.clickableTitle} numberOfLines={1}>
            {title} ▾
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      )}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
          <Text style={styles.textActionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Create new trip"
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Text style={styles.addLabel}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    backgroundColor: '#000000',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    color: '#ffffff',
  },
  titleButton: {
    flex: 1,
    paddingVertical: 6,
  },
  clickableTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLabel: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 24,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textAction: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  textActionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  addLabel: {
    color: '#00234E',
    fontSize: 27,
    fontWeight: '700',
    lineHeight: 29,
    marginTop: -1,
  },
  pressed: {
    opacity: 0.75,
  },
  menu: {
    position: 'absolute',
    zIndex: 2,
    minWidth: 140,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#D7D9DE',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'transparent',
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemPressed: {
    backgroundColor: '#F0F0F3',
  },
  signOutText: {
    color: '#B00020',
    fontSize: 15,
    fontWeight: '600',
  },
  menuText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D7D9DE',
    marginVertical: 2,
  },
});
