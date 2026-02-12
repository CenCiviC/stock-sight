import { StyleSheet, View } from "react-native";
import type { RankedStock } from "@/lib/scanner";
import type { RankChange } from "@/lib/db";
import { Card } from "./card";
import { StyledText } from "./text";
import { PriceText } from "./price-text";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

interface RankingCardProps {
  stock: RankedStock;
  rankChange: RankChange | null;
  onPress?: () => void;
}

function RankChangeBadge({ change }: { change: RankChange | null }) {
  if (!change) {
    return (
      <View style={[styles.badge, styles.badgeNeutral]}>
        <StyledText variant="caption" color={colors.secondary[400]} weight="semibold">
          -
        </StyledText>
      </View>
    );
  }

  // NEW entry
  if (change.prev_rank == null) {
    return (
      <View style={[styles.badge, styles.badgeInfo]}>
        <StyledText variant="caption" color={colors.info} weight="semibold">
          NEW
        </StyledText>
      </View>
    );
  }

  const delta = change.rank_delta!;

  if (delta > 0) {
    return (
      <View style={[styles.badge, styles.badgeSuccess]}>
        <StyledText variant="caption" color={colors.positive} weight="semibold">
          ▲{delta}
        </StyledText>
      </View>
    );
  }

  if (delta < 0) {
    return (
      <View style={[styles.badge, styles.badgeDanger]}>
        <StyledText variant="caption" color={colors.negative} weight="semibold">
          ▼{Math.abs(delta)}
        </StyledText>
      </View>
    );
  }

  // delta === 0
  return (
    <View style={[styles.badge, styles.badgeNeutral]}>
      <StyledText variant="caption" color={colors.secondary[400]} weight="semibold">
        ━
      </StyledText>
    </View>
  );
}

export function RankingCard({ stock, rankChange, onPress }: RankingCardProps) {
  const r3m = stock.returns.r_3m * 100;

  return (
    <Card onPress={onPress} style={styles.card}>
      {/* Row 1: Rank + Change + Ticker + Price */}
      <View style={styles.topRow}>
        <View style={styles.rankGroup}>
          <StyledText variant="data" color={colors.accent_warm[300]} weight="bold">
            #{stock.rank}
          </StyledText>
          <RankChangeBadge change={rankChange} />
        </View>
        <StyledText variant="h3" color={colors.accent_light[400]}>
          {stock.symbol}
        </StyledText>
        <View style={styles.topSpacer} />
        <PriceText value={stock.close} size="sm" />
      </View>

      {/* Row 2: Company name + Sector */}
      {(stock.name || stock.sector) && (
        <View style={styles.subRow}>
          {stock.name ? (
            <StyledText variant="caption" color={colors.secondary[400]} numberOfLines={1} style={styles.nameText}>
              {stock.name}
            </StyledText>
          ) : null}
          {stock.sector ? (
            <StyledText variant="caption" color={colors.secondary[500]}>
              {stock.sector}
            </StyledText>
          ) : null}
        </View>
      )}

      {/* Row 3: Metrics */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            RS
          </StyledText>
          <StyledText variant="data" color={colors.accent_warm[300]}>
            {stock.rs_percentile.toFixed(1)}
          </StyledText>
        </View>
        <View style={styles.metric}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            RS Chg
          </StyledText>
          <StyledText
            variant="data"
            color={stock.rs_change >= 0 ? colors.positive : colors.negative}
          >
            {stock.rs_change >= 0 ? "+" : ""}
            {stock.rs_change.toFixed(1)}
          </StyledText>
        </View>
        <View style={styles.metric}>
          <StyledText variant="caption" color={colors.secondary[500]}>
            3M
          </StyledText>
          <StyledText
            variant="data"
            color={r3m >= 0 ? colors.positive : colors.negative}
          >
            {r3m >= 0 ? "+" : ""}
            {r3m.toFixed(1)}%
          </StyledText>
        </View>
      </View>

      {/* Percentile bar */}
      <View style={styles.barBg}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(stock.rs_percentile, 100)}%` },
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
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  rankGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minWidth: 64,
  },
  topSpacer: {
    flex: 1,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  nameText: {
    flex: 1,
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  metric: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs - 1,
    borderRadius: borderRadius.sm,
  },
  badgeSuccess: {
    backgroundColor: "rgba(74, 222, 128, 0.15)",
  },
  badgeDanger: {
    backgroundColor: "rgba(248, 113, 113, 0.15)",
  },
  badgeInfo: {
    backgroundColor: "rgba(96, 165, 250, 0.15)",
  },
  badgeNeutral: {
    backgroundColor: `${colors.secondary[500]}20`,
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
