import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";
import { StyledText } from "./text";

interface ProgressBarProps {
  progress: number; // 0 to 1
  label?: string;
  showPercentage?: boolean;
  style?: ViewStyle;
}

export function ProgressBar({
  progress,
  label,
  showPercentage = true,
  style,
}: ProgressBarProps) {
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: clampedProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedProgress]);

  return (
    <View style={[styles.container, style]}>
      {(label || showPercentage) && (
        <View style={styles.labelRow}>
          {label && (
            <StyledText variant="caption" color={colors.secondary[400]}>
              {label}
            </StyledText>
          )}
          {showPercentage && (
            <StyledText variant="caption" color={colors.accent_warm[300]}>
              {Math.round(clampedProgress * 100)}%
            </StyledText>
          )}
        </View>
      )}
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  track: {
    height: 4,
    backgroundColor: colors.primary[700],
    borderRadius: borderRadius.full,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: colors.accent_warm[300],
    borderRadius: borderRadius.full,
  },
});
