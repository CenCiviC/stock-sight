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
import { addFavorite, getFavoritedSymbols, removeFavorite } from "@/lib/db";
import { useChartQuery, useCompanyProfileQuery, useFinancialsQuery } from "@/lib/queries";
import type { Stock } from "@/lib/scanner";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

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
  const router = useRouter();
  const db = useSQLiteContext();

  let stock: Stock | null = null;
  try {
    if (data) stock = JSON.parse(data);
  } catch {
    // ignore parse errors
  }

  const [period, setPeriod] = useState<PeriodKey>("6M");
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [isFavorited, setIsFavorited] = useState(false);
  const chartDays = PERIODS.find((p) => p.key === period)?.days ?? 180;

  const {
    data: chartResult,
    isLoading: chartLoading,
    error: chartErrorObj,
  } = useChartQuery({ symbol: symbol ?? "", days: chartDays });
  const {
    data: financials,
    isLoading: finLoading,
    error: finErrorObj,
  } = useFinancialsQuery({ symbol: symbol ?? "" });
  const { data: profile } = useCompanyProfileQuery({ symbol: symbol ?? "" });

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    (async () => {
      const syms = await getFavoritedSymbols(db);
      if (!cancelled) setIsFavorited(syms.has(symbol));
    })();
    return () => {
      cancelled = true;
    };
  }, [db, symbol]);

  const handleSearch = () => {
    const trimmed = searchInput.trim().toUpperCase();
    if (!trimmed || trimmed === symbol) {
      setSearchInput("");
      return;
    }
    setSearchInput("");
    router.replace({
      pathname: "/stock/[symbol]",
      params: { symbol: trimmed },
    });
  };

  const toggleFavorite = async () => {
    if (!symbol) return;
    if (isFavorited) {
      await removeFavorite(db, symbol);
      setIsFavorited(false);
    } else {
      const stockData: Stock = stock ?? {
        symbol,
        close: chartResult?.currentPrice ?? 0,
        rs_percentile: 0,
        rs_percentile_5days_ago: 0,
        rs_change: 0,
        returns: { r_12m: 0, r_6m: 0, r_3m: 0, r_1m: 0 },
      };
      await addFavorite(db, stockData, stock ? "scan" : "search");
      setIsFavorited(true);
    }
  };

  const bars = chartResult?.bars ?? null;
  const companyName = chartResult?.shortName ?? "";
  const chartError = chartErrorObj
    ? chartErrorObj instanceof Error
      ? chartErrorObj.message
      : "Failed to load chart"
    : null;
  const finError = finErrorObj
    ? finErrorObj instanceof Error
      ? finErrorObj.message
      : "Failed to load financials"
    : null;

  const returnPeriods: { label: string; key: keyof Stock["returns"] }[] = [
    { label: "12 Month", key: "r_12m" },
    { label: "6 Month", key: "r_6m" },
    { label: "3 Month", key: "r_3m" },
    { label: "1 Month", key: "r_1m" },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.secondary[500]} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          onSubmitEditing={handleSearch}
          placeholder="Search ticker (e.g., AAPL)"
          placeholderTextColor={colors.secondary[700]}
          style={styles.searchInput}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
        />
        {searchInput.length > 0 && (
          <Pressable onPress={() => setSearchInput("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.secondary[500]} />
          </Pressable>
        )}
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <StyledText variant="h2" color={colors.accent_light[400]}>
            {companyName || symbol}
          </StyledText>
          <Pressable onPress={toggleFavorite} hitSlop={8} style={styles.starBtn}>
            <Ionicons
              name={isFavorited ? "star" : "star-outline"}
              size={24}
              color={isFavorited ? colors.accent_warm[300] : colors.secondary[600]}
            />
          </Pressable>
        </View>
        {stock ? (
          <PriceText value={stock.close} size="lg" style={styles.headerPrice} />
        ) : chartResult ? (
          <PriceText value={chartResult.currentPrice} size="lg" style={styles.headerPrice} />
        ) : null}
        {profile && (
          <View style={styles.profileTags}>
            {!!profile.sector && (
              <View style={styles.profileTag}>
                <StyledText variant="caption" color={colors.secondary[400]}>
                  {profile.sector}
                </StyledText>
              </View>
            )}
            {!!profile.industry && (
              <View style={styles.profileTag}>
                <StyledText variant="caption" color={colors.secondary[400]}>
                  {profile.industry}
                </StyledText>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Company Summary */}
      {profile?.summary ? (
        <View style={styles.summaryContainer}>
          <StyledText
            variant="caption"
            color={colors.secondary[600]}
            numberOfLines={summaryExpanded ? undefined : 3}
            style={styles.summaryText}
          >
            {profile.summary}
          </StyledText>
          <Pressable
            onPress={() => setSummaryExpanded((prev) => !prev)}
            hitSlop={8}
          >
            <StyledText variant="caption" color={colors.accent_warm[300]}>
              {summaryExpanded ? "Close" : "More"}
            </StyledText>
          </Pressable>
        </View>
      ) : null}

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
          <StockChart bars={bars} height={300} maPeriods={[50]} emaPeriods={[9]} />
        )}
      </Card>

      {/* Relative Strength Card */}
      {stock && (
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
      )}

      {/* Returns Card */}
      {stock && (
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
      )}

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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.sm,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    color: colors.accent_light[400],
    fontFamily: "Inter",
    fontSize: 14,
    padding: 0,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing["2xl"],
    paddingTop: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  starBtn: {
    padding: spacing.xs,
  },
  headerPrice: {
    marginTop: spacing.xs,
  },
  profileTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  profileTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.sm,
  },
  summaryContainer: {
    marginBottom: spacing.lg,
  },
  summaryText: {
    lineHeight: 18,
    marginBottom: spacing.xs,
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
