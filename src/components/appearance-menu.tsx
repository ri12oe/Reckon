import { type ComponentRef, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { setAppearance, type AppearancePreference } from '@/appearance';
import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/hooks/use-appearance';
import { useTheme } from '@/hooks/use-theme';

const MENU_WIDTH = 240;

const options: { value: AppearancePreference; label: string; detail?: string }[] = [
  { value: 'system', label: 'System', detail: 'Match phone settings' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

type Anchor = { top: number; right: number };

/**
 * Lets Reckon follow the phone (System) or stay Light or Dark regardless
 * of the phone setting. The choice is saved on the device.
 */
export function AppearanceMenu() {
  const theme = useTheme();
  const preference = useAppearance();
  const buttonRef = useRef<ComponentRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + Spacing.two, right: x + width });
    });
  };

  const choose = (value: AppearancePreference) => {
    setAppearance(value);
    setAnchor(null);
  };

  return (
    <>
      <Pressable
        ref={buttonRef}
        accessibilityRole="button"
        accessibilityLabel="Appearance"
        accessibilityHint="Choose light, dark, or match your phone"
        onPress={open}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Glass style={[StyleSheet.absoluteFill, styles.buttonGlass]} />
        <Icon name="appearance" color={theme.text} />
      </Pressable>
      <Modal
        visible={anchor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnchor(null)}
      >
        <Pressable
          accessibilityLabel="Close appearance menu"
          style={StyleSheet.absoluteFill}
          onPress={() => setAnchor(null)}
        />
        {anchor ? (
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              {
                top: anchor.top,
                left: Math.max(Spacing.three, anchor.right - MENU_WIDTH),
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type="caption" themeColor="textSecondary" style={styles.title}>
              Appearance
            </ThemedText>
            {options.map((option) => {
              const selected = option.value === preference;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  testID={`appearance-${option.value}`}
                  onPress={() => choose(option.value)}
                  style={({ pressed }) => [
                    styles.row,
                    (selected || pressed) && { backgroundColor: theme.glassSelected },
                  ]}
                >
                  <View style={styles.rowText}>
                    <ThemedText>{option.label}</ThemedText>
                    {option.detail ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {option.detail}
                      </ThemedText>
                    ) : null}
                  </View>
                  {selected ? <Icon name="check" color={theme.accent} size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGlass: {
    borderRadius: 24,
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    padding: Spacing.one + Spacing.half,
    borderRadius: Radius.card,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  title: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
  },
  rowText: {
    flex: 1,
  },
});
