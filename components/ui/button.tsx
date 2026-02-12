import React from 'react';
import { Pressable, ActivityIndicator, StyleSheet, ViewStyle, PressableProps } from 'react-native';
import { StyledText } from './text';
import { colors } from '@/constants/colors';
import { spacing, borderRadius } from '@/constants/spacing';
import { fontWeights } from '@/constants/typography';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

const sizeStyles = {
  sm: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, fontSize: 13 },
  md: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.lg, fontSize: 15 },
  lg: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, fontSize: 17 },
};

export function Button({ title, variant = 'primary', size = 'md', loading, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  const sizeStyle = sizeStyles[size];

  const getBackgroundColor = () => {
    if (isDisabled) return colors.primary[700];
    if (variant === 'primary') return colors.accent_warm[300];
    if (variant === 'secondary') return 'transparent';
    return 'transparent';
  };

  const getTextColor = () => {
    if (isDisabled) return colors.secondary[600];
    if (variant === 'primary') return colors.primary[900];
    if (variant === 'secondary') return colors.secondary[200];
    return colors.accent_light[400];
  };

  const getBorderStyle = (): ViewStyle => {
    if (variant === 'secondary') return { borderWidth: 1, borderColor: isDisabled ? colors.primary[700] : colors.secondary[500] };
    return {};
  };

  return (
    <Pressable
      {...props}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: getBackgroundColor(), paddingVertical: sizeStyle.paddingVertical, paddingHorizontal: sizeStyle.paddingHorizontal },
        getBorderStyle(),
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <StyledText
          variant="label"
          color={getTextColor()}
          weight={variant === 'primary' ? 'bold' : 'medium'}
          style={{ fontSize: sizeStyle.fontSize }}
        >
          {title}
        </StyledText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
