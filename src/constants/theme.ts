/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    textSecondary: '#6C6C70',
    textTertiary: '#AEAEB2',
    background: '#F2F2F7',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E5E5EA',
    separator: '#D1D1D6',
    accent: '#007AFF',
    onAccent: '#ffffff',
    danger: '#FF3B30',
    success: '#34C759',
    canvas: '#FFFFFF',
    grid: '#E6E8EE',
    pathRaw: '#A1A1A8',
    pathCorrected: '#1C1C1E',
    glassFill: 'rgba(255, 255, 255, 0.62)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    glassSelected: 'rgba(0, 0, 0, 0.06)',
  },
  dark: {
    text: '#ffffff',
    textSecondary: '#98989F',
    textTertiary: '#5A5A60',
    background: '#000000',
    backgroundElement: '#1C1C1E',
    backgroundSelected: '#2C2C2E',
    separator: '#38383A',
    accent: '#0A84FF',
    onAccent: '#ffffff',
    danger: '#FF453A',
    success: '#30D158',
    canvas: '#0B0D12',
    grid: '#1A1D24',
    pathRaw: '#6E6E76',
    pathCorrected: '#FFFFFF',
    glassFill: 'rgba(255, 255, 255, 0.08)',
    glassBorder: 'rgba(255, 255, 255, 0.14)',
    glassSelected: 'rgba(255, 255, 255, 0.12)',
  },
} as const;

/** `#RRGGBB` plus an alpha, for tinted backgrounds such as a red Delete button. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  large: 22,
  card: 24,
} as const;

export const MaxContentWidth = 800;
