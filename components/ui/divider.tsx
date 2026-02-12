import React from 'react';
import { View, ViewStyle } from 'react-native';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

interface DividerProps {
  color?: string;
  marginVertical?: number;
  style?: ViewStyle;
}

export function Divider({ color = colors.primary[700], marginVertical = spacing.md, style }: DividerProps) {
  return <View style={[{ height: 1, backgroundColor: color, marginVertical }, style]} />;
}
