import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Glass } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'destructive';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
};

const LARGE = 54;
const COMPACT = 36;

/**
 * Capsule buttons. Primary is the one main action on a screen; glass sits over
 * the map canvas; destructive is for removing data.
 */
export function Button({
  label,
  variant = 'secondary',
  compact = false,
  icon,
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  const height = compact ? COMPACT : LARGE;
  const background =
    variant === 'primary'
      ? theme.accent
      : variant === 'destructive'
        ? withAlpha(theme.danger, 0.16)
        : variant === 'glass'
          ? 'transparent'
          : theme.backgroundSelected;
  const color =
    variant === 'primary' ? theme.onAccent : variant === 'destructive' ? theme.danger : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: height,
          borderRadius: height / 2,
          paddingHorizontal: compact ? Spacing.three : Spacing.four,
          backgroundColor: background,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {variant === 'glass' ? (
        <Glass style={[StyleSheet.absoluteFill, { borderRadius: height / 2 }]} />
      ) : null}
      <View style={styles.content}>
        {icon ? <Icon name={icon} color={color} size={compact ? 16 : 20} /> : null}
        <ThemedText type={compact ? 'smallBold' : 'headline'} style={{ color }}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: IconName;
  label: string;
  size?: number;
  color?: string;
  /** Glass floats over the canvas; plain sits on a card. */
  variant?: 'glass' | 'plain';
};

/** Round icon-only button, such as Share, Appearance, or a zoom control. */
export function IconButton({
  icon,
  label,
  size = 48,
  color,
  variant = 'glass',
  ...rest
}: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      {...rest}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {variant === 'glass' ? (
        <Glass style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
      ) : null}
      <Icon name={icon} color={color ?? theme.text} size={Math.round(size * 0.45)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  round: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
