import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { FavoriteRecord } from "@/lib/db";
import { Card } from "./card";
import { StyledText } from "./text";
import { PriceText } from "./price-text";
import { PercentageText } from "./percentage-text";
import { Badge } from "./badge";
import { colors } from "@/constants/colors";
import { spacing } from "@/constants/spacing";

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

function formatDaysAgo(dateStr: string): string {
  const saved = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - saved.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

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

      {/* Saved date row */}
      <View style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={12} color={colors.secondary[500]} />
        <StyledText variant="caption" color={colors.secondary[500]}>
          {formatDate(favorite.favorited_at)}
        </StyledText>
        <StyledText variant="caption" color={colors.secondary[600]}>
          · {formatDaysAgo(favorite.favorited_at)}
        </StyledText>
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
    marginBottom: spacing.sm,
  },
  priceCol: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
});
