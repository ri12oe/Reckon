import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code'
    | 'largeTitle'
    | 'title2'
    | 'headline'
    | 'footnote'
    | 'caption'
    | 'metric'
    | 'metricLarge';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  largeTitle: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  title2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: 700,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: 600,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 400,
  },
  caption: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metric: {
    fontFamily: Fonts.rounded,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  metricLarge: {
    fontFamily: Fonts.rounded,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
