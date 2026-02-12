import {
  Card,
  Divider,
  FinancialsChart,
  PercentageText,
  PriceText,
  StockChart,
  StyledText,
} from "@/components/ui";
import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import type { OHLCVBar, QuarterlyFinancial, Stock } from "@/lib/scanner";
import { fetchChart, fetchFinancials } from "@/lib/scanner";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

const PERIODS = [
  { key: "3M", days: 30 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
  { key: "5Y", days: 1825 },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

export default function StockDetail() {
  const { symbol, data } = useLocalSearchParams<{
    symbol: string;
    data: string;
  }>();

  let stock: Stock | null = null;
  try {
    if (data) stock = JSON.parse(data);
  } catch {
    // ignore parse errors
  }

  const [period, setPeriod] = useState<PeriodKey>("6M");
  const [bars, setBars] = useState<OHLCVBar[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [financials, setFinancials] = useState<QuarterlyFinancial[] | null>(
    null,
  );
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState<string | null>(null);

  const loadChart = useCallback(
    async (p: PeriodKey) => {
      if (!symbol) return;
      setChartLoading(true);
      setChartError(null);
      try {
        const days = PERIODS.find((pp) => pp.key === p)?.days ?? 180;
        const result = await fetchChart(symbol, days);
        setBars(result.bars);
      } catch (e) {
        setChartError(e instanceof Error ? e.message : "Failed to load chart");
      } finally {
        setChartLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    loadChart(period);
  }, [period, loadChart]);

  useEffect(() => {
    if (!symbol) return;
    setFinLoading(true);
    setFinError(null);
    fetchFinancials(symbol)
      .then(setFinancials)
      .catch((e) =>
        setFinError(
          e instanceof Error ? e.message : "Failed to load financials",
        ),
      )
      .finally(() => setFinLoading(false));
  }, [symbol]);

  if (!stock) {
    return (
      <View style={styles.container}>
        <StyledText
          variant="body"
          color={colors.negative}
          align="center"
          style={styles.errorText}
        >
          No data available for {symbol}
        </StyledText>
      </View>
    );
  }

  const returnPeriods: { label: string; key: keyof Stock["returns"] }[] = [
    { label: "12 Month", key: "r_12m" },
    { label: "6 Month", key: "r_6m" },
    { label: "3 Month", key: "r_3m" },
    { label: "1 Month", key: "r_1m" },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <StyledText variant="h1" color={colors.accent_light[400]}>
          {stock.symbol}
        </StyledText>
        <PriceText value={stock.close} size="lg" style={styles.headerPrice} />
      </View>

      {/* Chart */}
      <Card style={styles.card}>
        <View style={styles.periodBar}>
          {PERIODS.map((p) => {
            const isActive = period === p.key;
            return (
              <Pressable
                key={p.key}
                style={[styles.periodTab, isActive && styles.periodTabActive]}
                onPress={() => setPeriod(p.key)}
              >
                <StyledText
                  variant="caption"
                  weight={isActive ? "bold" : "medium"}
                  color={
                    isActive ? colors.accent_warm[300] : colors.secondary[600]
                  }
                >
                  {p.key}
                </StyledText>
              </Pressable>
            );
          })}
        </View>

        {chartLoading && (
          <View style={styles.chartPlaceholder}>
            <StyledText variant="bodySmall" color={colors.secondary[600]}>
              Loading chart...
            </StyledText>
          </View>
        )}

        {chartError && (
          <View style={styles.chartPlaceholder}>
            <StyledText variant="bodySmall" color={colors.negative}>
              {chartError}
            </StyledText>
          </View>
        )}

        {bars && !chartLoading && !chartError && (
          <StockChart bars={bars} height={300} />
        )}
      </Card>

      {/* Relative Strength Card */}
      <Card style={styles.card}>
        <StyledText
          variant="label"
          color={colors.secondary[500]}
          style={styles.cardTitle}
        >
          RELATIVE STRENGTH
        </StyledText>

        <View style={styles.rsRow}>
          <View style={styles.rsItem}>
            <StyledText variant="caption" color={colors.secondary[600]}>
              Current
            </StyledText>
            <StyledText variant="h2" color={colors.accent_warm[300]}>
              {stock.rs_percentile.toFixed(1)}
            </StyledText>
          </View>
          <View style={styles.rsItem}>
            <StyledText variant="caption" color={colors.secondary[600]}>
              5 Days Ago
            </StyledText>
            <StyledText variant="h2" color={colors.accent_light[400]}>
              {stock.rs_percentile_5days_ago.toFixed(1)}
            </StyledText>
          </View>
          <View style={styles.rsItem}>
            <StyledText variant="caption" color={colors.secondary[600]}>
              Change
            </StyledText>
            <PercentageText value={stock.rs_change} showArrow={true} />
          </View>
        </View>

        <Divider />

        {/* Percentile visualization */}
        <View style={styles.percentileContainer}>
          <View style={styles.percentileBarBg}>
            <View
              style={[
                styles.percentileBarFill,
                { width: `${Math.min(stock.rs_percentile, 100)}%` },
              ]}
            />
            <View
              style={[
                styles.percentileMarker,
                {
                  left: `${Math.min(stock.rs_percentile_5days_ago, 100)}%`,
                },
              ]}
            />
          </View>
          <View style={styles.percentileLabels}>
            {[0, 25, 50, 75, 100].map((n) => (
              <StyledText
                key={n}
                variant="caption"
                color={colors.secondary[700]}
              >
                {n}
              </StyledText>
            ))}
          </View>
        </View>
      </Card>

      {/* Returns Card */}
      <Card style={styles.card}>
        <StyledText
          variant="label"
          color={colors.secondary[500]}
          style={styles.cardTitle}
        >
          RETURNS
        </StyledText>

        {returnPeriods.map(({ label, key }, idx) => {
          const value = stock.returns[key];
          const pct = value * 100;
          const barWidth = Math.min(Math.abs(pct), 100);
          const barColor = value >= 0 ? colors.positive : colors.negative;

          return (
            <View key={key}>
              <View style={styles.returnRow}>
                <StyledText
                  variant="bodySmall"
                  color={colors.secondary[400]}
                  style={styles.returnLabel}
                >
                  {label}
                </StyledText>
                <View style={styles.returnBarContainer}>
                  <View
                    style={[
                      styles.returnBar,
                      { width: `${barWidth}%`, backgroundColor: barColor },
                    ]}
                  />
                </View>
                <PercentageText
                  value={pct}
                  showArrow={false}
                  showSign={true}
                  style={styles.returnValue}
                />
              </View>
              {idx < returnPeriods.length - 1 && (
                <Divider
                  color={colors.primary[700]}
                  marginVertical={spacing.sm}
                />
              )}
            </View>
          );
        })}
      </Card>

      {/* Financials Card */}
      <Card style={styles.card}>
        <StyledText
          variant="label"
          color={colors.secondary[500]}
          style={styles.cardTitle}
        >
          FINANCIALS
        </StyledText>

        {finLoading && (
          <View style={styles.chartPlaceholder}>
            <StyledText variant="bodySmall" color={colors.secondary[600]}>
              Loading financials...
            </StyledText>
          </View>
        )}

        {finError && !finLoading && (
          <StyledText variant="bodySmall" color={colors.secondary[600]}>
            {finError}
          </StyledText>
        )}

        {financials && !finLoading && !finError && (
          <FinancialsChart data={financials} />
        )}
      </Card>

      {/* License attribution */}
      <StyledText
        variant="caption"
        color={colors.secondary[700]}
        align="center"
        style={styles.attribution}
      >
        Charts powered by TradingView Lightweight Charts (Apache 2.0)
      </StyledText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary[950],
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing["5xl"],
  },
  errorText: {
    marginTop: spacing["5xl"],
  },
  header: {
    alignItems: "center",
    marginBottom: spacing["2xl"],
    paddingTop: spacing.sm,
  },
  headerPrice: {
    marginTop: spacing.xs,
  },
  card: {
    marginBottom: spacing.lg,
  },
  cardTitle: {
    letterSpacing: 1,
    marginBottom: spacing.lg,
  },
  // Chart period tabs
  periodBar: {
    flexDirection: "row",
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  periodTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: "transparent",
  },
  periodTabActive: {
    backgroundColor: colors.primary[700],
  },
  chartPlaceholder: {
    height: 300,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary[900],
    borderRadius: borderRadius.md,
  },
  // RS section
  rsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rsItem: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
  },
  percentileContainer: {
    marginTop: spacing.xs,
  },
  percentileBarBg: {
    height: 8,
    backgroundColor: colors.primary[700],
    borderRadius: borderRadius.full,
    overflow: "hidden",
    position: "relative",
  },
  percentileBarFill: {
    height: 8,
    backgroundColor: colors.accent_warm[300],
    borderRadius: borderRadius.full,
  },
  percentileMarker: {
    position: "absolute",
    top: -2,
    width: 3,
    height: 12,
    backgroundColor: colors.accent_warm[500],
    borderRadius: 1,
    marginLeft: -1,
  },
  percentileLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  // Returns
  returnRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  returnLabel: {
    width: 80,
  },
  returnBarContainer: {
    flex: 1,
    height: 6,
    backgroundColor: colors.primary[700],
    borderRadius: borderRadius.full,
    overflow: "hidden",
    marginHorizontal: spacing.md,
  },
  returnBar: {
    height: 6,
    borderRadius: borderRadius.full,
  },
  returnValue: {
    width: 95,
    flexShrink: 0,
    textAlign: "right",
  },
  attribution: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
});
