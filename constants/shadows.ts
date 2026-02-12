import { Platform, ViewStyle } from 'react-native';

type ShadowStyle = Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>;

const createShadow = (opacity: number, radius: number, elevation: number): ShadowStyle =>
  Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
    android: {
      elevation,
    },
    default: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
  }) as ShadowStyle;

export const shadows = {
  sm: createShadow(0.15, 4, 2),
  md: createShadow(0.25, 8, 4),
  lg: createShadow(0.3, 12, 8),
  xl: createShadow(0.4, 20, 12),
} as const;
