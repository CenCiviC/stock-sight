import { Platform } from 'react-native';

export const fonts = {
  main: Platform.select({
    ios: 'Inter',
    android: 'Inter',
    default: 'Inter',
  }) as string,
  data: Platform.select({
    ios: 'JetBrains Mono',
    android: 'JetBrainsMono',
    default: 'JetBrains Mono',
  }) as string,
} as const;

export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

export const lineHeights = {
  xs: 16,
  sm: 18,
  md: 22,
  lg: 24,
  xl: 28,
  '2xl': 32,
  '3xl': 40,
} as const;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
