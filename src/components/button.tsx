import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  compact?: boolean;
};

/** Primary is the one main action on a screen; destructive is for removing data. */
export function Button({ label, variant = 'secondary', compact = false, ...rest }: Props) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.accent : theme.backgroundSelected;
  const color =
    variant === 'primary' ? theme.onAccent : variant === 'destructive' ? theme.danger : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor: background, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ThemedText type={compact ? 'smallBold' : 'default'} style={[styles.label, { color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
  },
  compact: {
    minHeight: 36,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.small,
  },
  label: {
    fontWeight: 600,
  },
});
