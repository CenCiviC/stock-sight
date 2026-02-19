import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Stock, OHLCVBar } from "@/lib/scanner";
import { StyledText } from "./text";
import { PriceText } from "./price-text";
import { PercentageText } from "./percentage-text";
import { Card } from "./card";
import { StockChart } from "./stock-chart";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

const CHART_W = 80;
const CHART_H = 80;

interface StockCardProps {
  stock: Stock;
  chartBars?: OHLCVBar[];
  badge?: ReactNode;
  onPress?: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
}

export function StockCard({ stock, chartBars, badge, onPress, isFavorited, onToggleFavorite }: StockCardProps) {
  return (
    <Card onPress={onPress} style={styles.stockCard}>
      <View style={styles.cardHeader}>
        <View style={styles.symbolRow}>
          <StyledText variant="h3" color={colors.accent_light[400]}>
            {stock.symbol}
          </StyledText>
          {badge}
        </View>
        <View style={styles.headerRight}>
          <PriceText value={stock.close} />
          {onToggleFavorite && (
            <Pressable onPress={onToggleFavorite} hitSlop={8} style={styles.starBtn}>
              <Ionicons
                name={isFavorited ? "star" : "star-outline"}
                size={20}
                color={isFavorited ? colors.accent_warm[300] : colors.secondary[600]}
              />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.metricsCol}>
          <View style={styles.metric}>
            <StyledText variant="caption" color={colors.secondary[500]}>
              RS Percentile
            </StyledText>
            <StyledText variant="data" color={colors.accent_warm[300]}>
              {stock.rs_percentile.toFixed(1)}
            </StyledText>
          </View>
          <View style={styles.metric}>
            <StyledText variant="caption" color={colors.secondary[500]}>
              RS Change
            </StyledText>
            <PercentageText
              value={stock.rs_change}
              showArrow={false}
              showSign={true}
            />
          </View>
          <View style={styles.metric}>
            <StyledText variant="caption" color={colors.secondary[500]}>
              3M Return
            </StyledText>
            <PercentageText
              value={stock.returns.r_3m * 100}
              showArrow={false}
              showSign={true}
            />
          </View>
        </View>

        {chartBars && chartBars.length >= 2 && (
          <View style={styles.chartContainer}>
            <StockChart bars={chartBars} height={CHART_H} compact />
          </View>
        )}
      </View>

      <View style={styles.percentileBarBg}>
        <View
          style={[
            styles.percentileBarFill,
            { width: `${Math.min(stock.rs_percentile, 100)}%` },
          ]}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stockCard: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  starBtn: {
    padding: spacing.xs,
  },
  symbolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  metricsCol: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metric: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
  },
  chartContainer: {
    width: CHART_W,
    marginLeft: spacing.md,
  },
  percentileBarBg: {
    height: 4,
    backgroundColor: colors.primary[700],
    borderRadius: borderRadius.full,
    overflow: "hidden",
  },
  percentileBarFill: {
    height: 4,
    backgroundColor: colors.accent_warm[300],
    borderRadius: borderRadius.full,
  },
});
