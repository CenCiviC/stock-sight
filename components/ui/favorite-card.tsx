import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { FavoriteRecord } from "@/lib/db";
import { Card } from "./card";
import { StyledText } from "./text";
import { PriceText } from "./price-text";
import { PercentageText } from "./percentage-text";
import { Badge } from "./badge";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

interface FavoriteCardProps {
  favorite: FavoriteRecord;
  currentPrice: number | null;
  isLoadingPrice: boolean;
  onPress?: () => void;
  onRemove: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  nasdaq: "NASDAQ",
  russell_1000: "Russell",
  sp500: "S&P 500",
};

export function FavoriteCard({
  favorite,
  currentPrice,
  isLoadingPrice,
  onPress,
  onRemove,
}: FavoriteCardProps) {
  const changePercent =
    currentPrice != null
      ? ((currentPrice - favorite.close) / favorite.close) * 100
      : null;

  return (
    <Card onPress={onPress} style={styles.card}>
      {/* Header: Symbol + Source badge + Star */}
      <View style={styles.header}>
        <View style={styles.symbolRow}>
          <StyledText variant="h3" color={colors.accent_light[400]}>
            {favorite.symbol}
          </StyledText>
          <Badge
            label={SOURCE_LABELS[favorite.source_index] ?? favorite.source_index}
            variant="neutral"
          />
        </View>
        <Pressable onPress={onRemove} hitSlop={8} style={styles.starBtn}>
          <Ionicons name="star" size={20} color={colors.accent_warm[300]} />
        </Pressable>
      </View>

      {/* Price comparison row */}
      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            Saved
          </StyledText>
          <PriceText value={favorite.close} size="sm" />
        </View>
        <View style={styles.priceCol}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            Now
          </StyledText>
          {isLoadingPrice ? (
            <ActivityIndicator size="small" color={colors.secondary[500]} />
          ) : currentPrice != null ? (
            <PriceText value={currentPrice} size="sm" />
          ) : (
            <StyledText variant="data" color={colors.secondary[600]}>
              —
            </StyledText>
          )}
        </View>
        <View style={styles.priceCol}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            Change
          </StyledText>
          {changePercent != null ? (
            <PercentageText value={changePercent} showArrow={false} showSign />
          ) : (
            <StyledText variant="data" color={colors.secondary[600]}>
              —
            </StyledText>
          )}
        </View>
      </View>

      {/* RS percentile bar */}
      <View style={styles.rsRow}>
        <StyledText variant="caption" color={colors.secondary[500]}>
          RS: {favorite.rs_percentile.toFixed(1)}
        </StyledText>
      </View>
      <View style={styles.barBg}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(favorite.rs_percentile, 100)}%` },
          ]}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  symbolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  starBtn: {
    padding: spacing.xs,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  priceCol: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
  },
  rsRow: {
    marginBottom: spacing.xs,
  },
  barBg: {
    height: 4,
    backgroundColor: colors.primary[700],
    borderRadius: borderRadius.full,
    overflow: "hidden",
  },
  barFill: {
    height: 4,
    backgroundColor: colors.accent_warm[300],
    borderRadius: borderRadius.full,
  },
});
