import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Translucent panel that stands in for Liquid Glass where it is not
 * available (Android, web, iOS before 26). See `glass.ios.tsx`.
 */
export function Glass({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.glass,
        { backgroundColor: theme.glassFill, borderColor: theme.glassBorder },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glass: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
