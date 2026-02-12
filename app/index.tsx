import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { runScan, fetchChart } from "@/lib/scanner";
import type { Stock, ScanResult, ScanProgress, IndexType, OHLCVBar } from "@/lib/scanner";
import { StyledText, PriceText, PercentageText, Card, Button, ProgressBar, Divider, StockChart } from "@/components/ui";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

const TABS: { key: IndexType; label: string }[] = [
  { key: "nasdaq", label: "NASDAQ" },
  { key: "russell_1000", label: "Russell 1000" },
  { key: "sp500", label: "S&P 500" },
];

const SPARKLINE_W = 80;
const SPARKLINE_H = 80;

export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<IndexType>("nasdaq");
  const [results, setResults] = useState<Partial<Record<IndexType, ScanResult>>>({});
  const [scanningIndex, setScanningIndex] = useState<IndexType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Chart cache: symbol → OHLCV bars (1M)
  const [chartCache, setChartCache] = useState<Record<string, OHLCVBar[]>>({});
  const chartLoadingRef = useRef(false);

  const currentResult = results[activeTab] ?? null;
  const isScanning = scanningIndex === activeTab;
  const isAnyScanRunning = scanningIndex !== null;

  const startScan = useCallback(async () => {
    if (scanningIndex !== null) return; // prevent concurrent scans

    const target = activeTab;
    setScanningIndex(target);
    setError(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const scanResult = await runScan({
        index: target,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setResults((prev) => ({ ...prev, [target]: scanResult }));
    } catch (e) {
      if ((e as Error).message !== "Scan aborted") {
        setError(e instanceof Error ? e.message : "Scan failed");
      }
    } finally {
      setScanningIndex(null);
      setProgress(null);
      abortRef.current = null;
    }
  }, [activeTab, scanningIndex]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Load 1M sparkline data for scan results
  useEffect(() => {
    if (!currentResult || currentResult.stocks.length === 0) return;
    if (chartLoadingRef.current) return;

    const symbols = currentResult.stocks
      .map((s) => s.symbol)
      .filter((sym) => !chartCache[sym]);

    if (symbols.length === 0) return;

    chartLoadingRef.current = true;

    (async () => {
      const newCache: Record<string, OHLCVBar[]> = {};
      const concurrency = 5;

      for (let i = 0; i < symbols.length; i += concurrency) {
        const batch = symbols.slice(i, i + concurrency);
        const promises = batch.map(async (sym) => {
          try {
            const result = await fetchChart(sym, 30);
            newCache[sym] = result.bars;
          } catch {
            // skip failed
          }
        });
        await Promise.all(promises);
      }

      setChartCache((prev) => ({ ...prev, ...newCache }));
      chartLoadingRef.current = false;
    })();
  }, [currentResult]);

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const renderStockItem = ({ item }: { item: Stock }) => {
    const sparkData = chartCache[item.symbol];

    return (
      <Card
        onPress={() =>
          router.push({
            pathname: "/stock/[symbol]",
            params: { symbol: item.symbol, data: JSON.stringify(item) },
          })
        }
        style={styles.stockCard}
      >
        <View style={styles.cardHeader}>
          <StyledText variant="h3" color={colors.accent_light[400]}>
            {item.symbol}
          </StyledText>
          <PriceText value={item.close} />
        </View>

        <View style={styles.cardBody}>
          <View style={styles.metricsCol}>
            <View style={styles.metric}>
              <StyledText variant="caption" color={colors.secondary[500]}>
                RS Percentile
              </StyledText>
              <StyledText variant="data" color={colors.accent_warm[300]}>
                {item.rs_percentile.toFixed(1)}
              </StyledText>
            </View>
            <View style={styles.metric}>
              <StyledText variant="caption" color={colors.secondary[500]}>
                RS Change
              </StyledText>
              <PercentageText
                value={item.rs_change}
                showArrow={false}
                showSign={true}
              />
            </View>
            <View style={styles.metric}>
              <StyledText variant="caption" color={colors.secondary[500]}>
                3M Return
              </StyledText>
              <PercentageText
                value={item.returns.r_3m * 100}
                showArrow={false}
                showSign={true}
              />
            </View>
          </View>

          {sparkData && sparkData.length >= 2 && (
            <View style={styles.sparklineContainer}>
              <StockChart
                bars={sparkData}
                height={SPARKLINE_H}
                compact
              />
            </View>
          )}
        </View>

        <View style={styles.percentileBarBg}>
          <View
            style={[
              styles.percentileBarFill,
              { width: `${Math.min(item.rs_percentile, 100)}%` },
            ]}
          />
        </View>
      </Card>
    );
  };

  const progressValue =
    progress?.total && progress.total > 0
      ? progress.current / progress.total
      : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Tab Header */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const hasResult = !!results[tab.key];
          const isBusy = scanningIndex === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <StyledText
                variant="bodySmall"
                weight={isActive ? "bold" : "medium"}
                color={isActive ? colors.accent_warm[300] : colors.secondary[600]}
              >
                {tab.label}
              </StyledText>
              {isBusy ? (
                <View style={styles.tabDotScanning} />
              ) : hasResult ? (
                <View style={styles.tabDot} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Divider color={colors.primary[800]} marginVertical={0} />

      {/* Scanning state */}
      {isScanning && (
        <View style={styles.scanningSection}>
          <ProgressBar
            progress={progressValue}
            label={progress?.message ?? "Initializing..."}
            style={styles.progressBar}
          />
          <Button
            title="Cancel"
            variant="secondary"
            size="sm"
            onPress={cancelScan}
            style={styles.cancelBtn}
          />
        </View>
      )}

      {/* Error */}
      {error && activeTab === activeTab && (
        <View style={styles.errorBox}>
          <StyledText variant="bodySmall" color={colors.negative}>
            {error}
          </StyledText>
        </View>
      )}

      {/* No result yet → show scan prompt */}
      {!currentResult && !isScanning && (
        <View style={styles.emptyState}>
          <StyledText variant="h2" color={colors.primary[400]} style={styles.emptyIcon}>
            ?
          </StyledText>
          <StyledText variant="bodyLarge" color={colors.secondary[400]} style={styles.emptyTitle}>
            No scan results yet
          </StyledText>
          <StyledText variant="bodySmall" color={colors.secondary[600]} style={styles.emptyDesc}>
            Scan {TABS.find((t) => t.key === activeTab)?.label} to find stocks matching VCP conditions
          </StyledText>
          {isAnyScanRunning ? (
            <StyledText variant="bodySmall" color={colors.secondary[600]}>
              {TABS.find((t) => t.key === scanningIndex)?.label} scanning in progress...
            </StyledText>
          ) : (
            <Button
              title="Scan Now"
              variant="primary"
              size="lg"
              onPress={startScan}
              style={styles.scanBtn}
            />
          )}
        </View>
      )}

      {/* Results */}
      {currentResult && (
        <>
          <View style={styles.resultHeader}>
            <StyledText variant="bodyLarge" weight="semibold">
              {currentResult.count} stock{currentResult.count !== 1 ? "s" : ""} found
            </StyledText>
            <View style={styles.resultHeaderRight}>
              <StyledText variant="caption" color={colors.secondary[600]}>
                {formatTimestamp(currentResult.scanned_at)}
              </StyledText>
              <Button
                title="Rescan"
                variant="secondary"
                size="sm"
                onPress={startScan}
                disabled={isAnyScanRunning}
                style={styles.rescanBtn}
              />
            </View>
          </View>
          <Divider color={colors.primary[800]} marginVertical={0} />
          <FlatList
            data={currentResult.stocks}
            keyExtractor={(item) => item.symbol}
            renderItem={renderStockItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            extraData={chartCache}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary[950],
  },
  // Tab bar
  tabBar: {
    flexDirection: "row",
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.accent_warm[300],
  },
  tabDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.positive,
  },
  tabDotScanning: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  // Scanning
  scanningSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  progressBar: {
    marginBottom: spacing.xs,
  },
  cancelBtn: {
    alignSelf: "center",
    paddingHorizontal: spacing["3xl"],
  },
  // Error
  errorBox: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "rgba(248, 113, 113, 0.1)",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.negative,
  },
  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["3xl"],
    gap: spacing.sm,
  },
  emptyIcon: {
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    marginBottom: spacing.xs,
  },
  emptyDesc: {
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  scanBtn: {
    paddingHorizontal: spacing["5xl"],
  },
  // Results
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  resultHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rescanBtn: {
    paddingHorizontal: spacing.md,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    ...Platform.select({
      web: { paddingBottom: 32 },
      default: { paddingBottom: 40 },
    }),
  },
  stockCard: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
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
  sparklineContainer: {
    width: SPARKLINE_W,
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
