import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { StyledText } from './text';
import { colors } from '@/constants/colors';
import { spacing, borderRadius } from '@/constants/spacing';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: 'rgba(74, 222, 128, 0.15)', text: colors.positive },
  warning: { bg: 'rgba(251, 191, 36, 0.15)', text: colors.warning },
  danger: { bg: 'rgba(248, 113, 113, 0.15)', text: colors.negative },
  info: { bg: 'rgba(96, 165, 250, 0.15)', text: colors.info },
  neutral: { bg: `${colors.secondary[500]}20`, text: colors.secondary[400] },
};

export function Badge({ label, variant = 'neutral', style }: BadgeProps) {
  const { bg, text } = variantColors[variant];
  return (
    <View style={[styles.container, { backgroundColor: bg }, style]}>
      <StyledText variant="caption" color={text} weight="semibold">
        {label}
      </StyledText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs - 1,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
});
