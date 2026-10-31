import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** Checked once: some iOS 26 betas lack the API and crash if GlassView renders. */
const liquidGlass = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

/** Liquid Glass on iOS 26+, following the in-app Appearance choice. */
export function Glass({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  const scheme = useColorScheme();

  if (liquidGlass) {
    return (
      <GlassView
        {...rest}
        glassEffectStyle="regular"
        colorScheme={scheme}
        style={[styles.glass, style]}
      />
    );
  }

  return (
    <View
      {...rest}
      style={[
        styles.glass,
        styles.fallback,
        { backgroundColor: theme.glassFill, borderColor: theme.glassBorder },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glass: {
    overflow: 'hidden',
  },
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
