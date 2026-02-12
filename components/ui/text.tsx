import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { colors } from '@/constants/colors';
import { fonts, fontSizes, lineHeights, fontWeights } from '@/constants/typography';

type TextVariant = 'h1' | 'h2' | 'h3' | 'bodyLarge' | 'body' | 'bodySmall' | 'caption' | 'data' | 'label';

interface StyledTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  weight?: keyof typeof fontWeights;
  align?: TextStyle['textAlign'];
}

const variantStyles: Record<TextVariant, TextStyle> = {
  h1: { fontFamily: fonts.main, fontSize: fontSizes['3xl'], lineHeight: lineHeights['3xl'], fontWeight: fontWeights.bold },
  h2: { fontFamily: fonts.main, fontSize: fontSizes['2xl'], lineHeight: lineHeights['2xl'], fontWeight: fontWeights.bold },
  h3: { fontFamily: fonts.main, fontSize: fontSizes.xl, lineHeight: lineHeights.xl, fontWeight: fontWeights.semibold },
  bodyLarge: { fontFamily: fonts.main, fontSize: fontSizes.lg, lineHeight: lineHeights.lg, fontWeight: fontWeights.regular },
  body: { fontFamily: fonts.main, fontSize: fontSizes.md, lineHeight: lineHeights.md, fontWeight: fontWeights.regular },
  bodySmall: { fontFamily: fonts.main, fontSize: fontSizes.sm, lineHeight: lineHeights.sm, fontWeight: fontWeights.regular },
  caption: { fontFamily: fonts.main, fontSize: fontSizes.xs, lineHeight: lineHeights.xs, fontWeight: fontWeights.regular },
  data: { fontFamily: fonts.data, fontSize: fontSizes.lg, lineHeight: lineHeights.lg, fontWeight: fontWeights.medium },
  label: { fontFamily: fonts.main, fontSize: fontSizes.sm, lineHeight: lineHeights.sm, fontWeight: fontWeights.medium },
};

export function StyledText({ variant = 'body', color = colors.accent_light[400], weight, align, style, ...props }: StyledTextProps) {
  const variantStyle = variantStyles[variant];
  return (
    <Text
      style={[
        variantStyle,
        { color },
        weight && { fontWeight: fontWeights[weight] },
        align && { textAlign: align },
        style,
      ]}
      {...props}
    />
  );
}
