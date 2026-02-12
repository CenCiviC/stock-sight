import React from 'react';
import { SafeAreaView as RNSafeAreaView, ViewStyle, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';

interface SafeAreaViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function SafeAreaView({ children, style }: SafeAreaViewProps) {
  return (
    <RNSafeAreaView style={[styles.container, style]}>
      {children}
    </RNSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary[950],
  },
});
