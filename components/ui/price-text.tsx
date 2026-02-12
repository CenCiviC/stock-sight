import React from 'react';
import { TextStyle } from 'react-native';
import { StyledText } from './text';
import { colors } from '@/constants/colors';
import { fonts, fontSizes, lineHeights, fontWeights } from '@/constants/typography';

interface PriceTextProps {
  value: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: TextStyle;
}

const sizeMap = {
  sm: { fontSize: fontSizes.sm, lineHeight: lineHeights.sm },
  md: { fontSize: fontSizes.lg, lineHeight: lineHeights.lg },
  lg: { fontSize: fontSizes['2xl'], lineHeight: lineHeights['2xl'] },
};

export function PriceText({ value, currency = '$', size = 'md', style }: PriceTextProps) {
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sizeStyle = sizeMap[size];

  return (
    <StyledText
      variant="data"
      color={colors.accent_warm[300]}
      style={[{ fontFamily: fonts.data, fontWeight: fontWeights.semibold, ...sizeStyle }, style]}
    >
      {currency}{formatted}
    </StyledText>
  );
}
