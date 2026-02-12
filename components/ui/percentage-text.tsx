import React from 'react';
import { TextStyle } from 'react-native';
import { StyledText } from './text';
import { colors } from '@/constants/colors';

interface PercentageTextProps {
  value: number;
  showArrow?: boolean;
  showSign?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: TextStyle;
}

export function PercentageText({ value, showArrow = true, showSign = true, size = 'md', style }: PercentageTextProps) {
  const isPositive = value >= 0;
  const color = isPositive ? colors.positive : colors.negative;
  const arrow = isPositive ? '▲' : '▼';
  const sign = isPositive ? '+' : '';
  const formatted = `${showSign ? sign : ''}${value.toFixed(2)}%`;

  return (
    <StyledText
      variant="data"
      color={color}
      numberOfLines={1}
      style={[style]}
    >
      {showArrow ? `${arrow} ` : ''}{formatted}
    </StyledText>
  );
}
