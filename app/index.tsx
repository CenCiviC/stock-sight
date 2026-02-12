import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { runScan, runRsScan, fetchChart } from "@/lib/scanner";
import type {
  Stock,
  ScanResult,
  ScanProgress,
  IndexType,
  OHLCVBar,
  RankedStock,
  RsRankingResult,
  SectorCount,
} from "@/lib/scanner";
import { saveScan, getLatestScan, compareScanResults, saveRsRanking, getLatestRsRanking, compareRankings } from "@/lib/db";
import type { ComparisonResult, RankChange } from "@/lib/db";
import { StyledText, Button, ProgressBar, Divider, Badge, StockCard, SectorChart, RankingCard } from "@/components/ui";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

type ActiveView = "rs_top" | IndexType;

const VCP_TABS: { key: IndexType; label: string }[] = [
  { key: "nasdaq", label: "NASDAQ" },
  { key: "russell_1000", label: "Russell 1000" },
  { key: "sp500", label: "S&P 500" },
];

export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();

  const [activeView, setActiveView] = useState<ActiveView>("rs_top");

  // --- VCP scan state ---
  const [results, setResults] = useState<Partial<Record<IndexType, ScanResult>>>({});
  const [comparisons, setComparisons] = useState<Partial<Record<IndexType, ComparisonResult>>>({});
  const [scanningIndex, setScanningIndex] = useState<IndexType | null>(null);

  // --- RS ranking state ---
  const [rsResult, setRsResult] = useState<RsRankingResult | null>(null);
  const [rsRankChanges, setRsRankChanges] = useState<Map<string, RankChange>>(new Map());
  const [rsPrevSectors, setRsPrevSectors] = useState<SectorCount[]>([]);
  const [rsScanning, setRsScanning] = useState(false);

  // --- Shared state ---
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [dbLoaded, setDbLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Chart cache: symbol → OHLCV bars (1M)
  const [chartCache, setChartCache] = useState<Record<string, OHLCVBar[]>>({});
  const chartLoadingRef = useRef(false);

  const isRsTop = activeView === "rs_top";
  const activeTab = isRsTop ? null : (activeView as IndexType);
  const currentResult = activeTab ? (results[activeTab] ?? null) : null;
  const isScanning = isRsTop ? rsScanning : scanningIndex === activeTab;
  const isAnyScanRunning = scanningIndex !== null || rsScanning;

  // Load latest data from DB on mount
  useEffect(() => {
    (async () => {
      const loaded: Partial<Record<IndexType, ScanResult>> = {};
      for (const tab of VCP_TABS) {
        const record = await getLatestScan(db, tab.key);
        if (record) {
          loaded[tab.key] = {
            index: record.index_type,
            count: record.count,
            scanned_at: record.scanned_at,
            stocks: record.stocks,
          };
        }
      }
      setResults(loaded);

      // Load RS ranking
      const rsRecord = await getLatestRsRanking(db);
      if (rsRecord) {
        // Reconstruct sectors from stocks
        const sectorCounts = new Map<string, number>();
        for (const stock of rsRecord.stocks) {
          sectorCounts.set(stock.sector, (sectorCounts.get(stock.sector) ?? 0) + 1);
        }
        const sectors: SectorCount[] = Array.from(sectorCounts.entries())
          .map(([sector, count]) => ({ sector, count }))
          .sort((a, b) => b.count - a.count);

        setRsResult({
          count: rsRecord.count,
          scanned_at: rsRecord.scanned_at,
          stocks: rsRecord.stocks,
          sectors,
        });
      }

      setDbLoaded(true);
    })();
  }, [db]);

  // VCP scan
  const startVcpScan = useCallback(async () => {
    if (isAnyScanRunning || !activeTab) return;

    const target = activeTab;
    setScanningIndex(target);
    setError(null);
    setProgress(null);

    const previousScan = await getLatestScan(db, target);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const scanResult = await runScan({
        index: target,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      await saveScan(db, scanResult);
      setResults((prev) => ({ ...prev, [target]: scanResult }));

      if (previousScan) {
        const comparison = compareScanResults(scanResult.stocks, previousScan.stocks);
        setComparisons((prev) => ({ ...prev, [target]: comparison }));
      } else {
        setComparisons((prev) => {
          const next = { ...prev };
          delete next[target];
          return next;
        });
      }
    } catch (e) {
      if ((e as Error).message !== "Scan aborted") {
        setError(e instanceof Error ? e.message : "Scan failed");
      }
    } finally {
      setScanningIndex(null);
      setProgress(null);
      abortRef.current = null;
    }
  }, [activeTab, isAnyScanRunning, db]);

  // RS scan
  const startRsScan = useCallback(async () => {
    if (isAnyScanRunning) return;

    setRsScanning(true);
    setError(null);
    setProgress(null);

    // Keep previous result for comparison
    const previousStocks = rsResult?.stocks ?? null;
    const previousSectors = rsResult?.sectors ?? [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runRsScan({
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      await saveRsRanking(db, result);
      setRsResult(result);

      // Compute rank & sector changes
      if (previousStocks && previousStocks.length > 0) {
        setRsRankChanges(compareRankings(result.stocks, previousStocks));
        setRsPrevSectors(previousSectors);
      } else {
        setRsRankChanges(new Map());
        setRsPrevSectors([]);
      }
    } catch (e) {
      if ((e as Error).message !== "Scan aborted") {
        setError(e instanceof Error ? e.message : "Scan failed");
      }
    } finally {
      setRsScanning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [isAnyScanRunning, rsResult, db]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Load 1M chart data for VCP scan results
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

  // Precompute VCP comparison lookups
  const comparison = activeTab ? comparisons[activeTab] : undefined;
  const newSymbolSet = useMemo(
    () => new Set(comparison?.new_entries.map((s) => s.symbol) ?? []),
    [comparison]
  );
  const commonMap = useMemo(
    () => new Map(comparison?.common.map((c) => [c.symbol, c]) ?? []),
    [comparison]
  );

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const renderStockItem = ({ item }: { item: Stock }) => {
    let badge = null;
    if (comparison) {
      if (newSymbolSet.has(item.symbol)) {
        badge = <Badge label="NEW" variant="info" />;
      } else {
        const common = commonMap.get(item.symbol);
        if (common && common.rs_delta > 0) {
          badge = <Badge label={`RS +${common.rs_delta.toFixed(1)}`} variant="success" />;
        } else if (common && common.rs_delta < 0) {
          badge = <Badge label={`RS ${common.rs_delta.toFixed(1)}`} variant="danger" />;
        }
      }
    }

    return (
      <StockCard
        stock={item}
        chartBars={chartCache[item.symbol]}
        badge={badge}
        onPress={() =>
          router.push({
            pathname: "/stock/[symbol]",
            params: { symbol: item.symbol, data: JSON.stringify(item) },
          })
        }
      />
    );
  };

  const renderRankingItem = ({ item }: { item: RankedStock }) => (
    <RankingCard
      stock={item}
      rankChange={rsRankChanges.get(item.symbol) ?? null}
      onPress={() =>
        router.push({
          pathname: "/stock/[symbol]",
          params: {
            symbol: item.symbol,
            data: JSON.stringify({
              symbol: item.symbol,
              close: item.close,
              rs_percentile: item.rs_percentile,
              rs_percentile_5days_ago: item.rs_percentile_5days_ago,
              rs_change: item.rs_change,
              returns: item.returns,
            }),
          },
        })
      }
    />
  );

  const progressValue =
    progress?.total && progress.total > 0
      ? progress.current / progress.total
      : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Tab Header */}
      <View style={styles.tabRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
          {/* RS Top tab */}
          <Pressable
            style={[styles.tab, isRsTop && styles.tabActive]}
            onPress={() => setActiveView("rs_top")}
          >
            <StyledText
              variant="bodySmall"
              weight={isRsTop ? "bold" : "medium"}
              color={isRsTop ? colors.accent_warm[300] : colors.secondary[600]}
            >
              RS Top
            </StyledText>
            {rsScanning ? (
              <View style={styles.tabDotScanning} />
            ) : rsResult ? (
              <View style={styles.tabDot} />
            ) : null}
          </Pressable>

          {/* VCP tabs */}
          {VCP_TABS.map((tab) => {
            const isActive = activeView === tab.key;
            const hasResult = !!results[tab.key];
            const isBusy = scanningIndex === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveView(tab.key)}
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
        </ScrollView>

        <Pressable
          style={styles.historyBtn}
          onPress={() =>
            router.push({
              pathname: "/history" as any,
              params: { index: activeTab ?? "sp500" },
            })
          }
          hitSlop={8}
        >
          <Ionicons name="time-outline" size={20} color={colors.secondary[500]} />
        </Pressable>
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
      {error && (
        <View style={styles.errorBox}>
          <StyledText variant="bodySmall" color={colors.negative}>
            {error}
          </StyledText>
        </View>
      )}

      {/* === RS Top View === */}
      {isRsTop && !isScanning && (
        <>
          {/* No result → show scan prompt */}
          {!rsResult && dbLoaded && (
            <View style={styles.emptyState}>
              <StyledText variant="h2" color={colors.primary[400]} style={styles.emptyIcon}>
                ?
              </StyledText>
              <StyledText variant="bodyLarge" color={colors.secondary[400]} style={styles.emptyTitle}>
                No RS rankings yet
              </StyledText>
              <StyledText variant="bodySmall" color={colors.secondary[600]} style={styles.emptyDesc}>
                Scan S&P 500 to rank top 100 stocks by Relative Strength
              </StyledText>
              {isAnyScanRunning ? (
                <StyledText variant="bodySmall" color={colors.secondary[600]}>
                  Another scan in progress...
                </StyledText>
              ) : (
                <Button
                  title="Scan Now"
                  variant="primary"
                  size="lg"
                  onPress={startRsScan}
                  style={styles.scanBtn}
                />
              )}
            </View>
          )}

          {/* RS Results */}
          {rsResult && (
            <>
              <FlatList
                data={rsResult.stocks}
                keyExtractor={(item) => item.symbol}
                renderItem={renderRankingItem}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                extraData={rsRankChanges}
                ListHeaderComponent={
                  <>
                    <View style={styles.rsListHeader}>
                      <StyledText variant="caption" color={colors.secondary[600]}>
                        {formatTimestamp(rsResult.scanned_at)}
                      </StyledText>
                      <Button
                        title="Rescan"
                        variant="secondary"
                        size="sm"
                        onPress={startRsScan}
                        disabled={isAnyScanRunning}
                      />
                    </View>
                    {rsResult.sectors.length > 0 && (
                      <SectorChart sectors={rsResult.sectors} prevSectors={rsPrevSectors.length > 0 ? rsPrevSectors : undefined} total={rsResult.count} />
                    )}
                  </>
                }
              />
            </>
          )}
        </>
      )}

      {/* === VCP View === */}
      {!isRsTop && (
        <>
          {/* No result → show scan prompt */}
          {!currentResult && !isScanning && dbLoaded && (
            <View style={styles.emptyState}>
              <StyledText variant="h2" color={colors.primary[400]} style={styles.emptyIcon}>
                ?
              </StyledText>
              <StyledText variant="bodyLarge" color={colors.secondary[400]} style={styles.emptyTitle}>
                No scan results yet
              </StyledText>
              <StyledText variant="bodySmall" color={colors.secondary[600]} style={styles.emptyDesc}>
                Scan {VCP_TABS.find((t) => t.key === activeTab)?.label} to find stocks matching VCP conditions
              </StyledText>
              {isAnyScanRunning ? (
                <StyledText variant="bodySmall" color={colors.secondary[600]}>
                  {scanningIndex
                    ? `${VCP_TABS.find((t) => t.key === scanningIndex)?.label} scanning in progress...`
                    : "RS scan in progress..."}
                </StyledText>
              ) : (
                <Button
                  title="Scan Now"
                  variant="primary"
                  size="lg"
                  onPress={startVcpScan}
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
                <Button
                  title="Rescan"
                  variant="secondary"
                  size="sm"
                  onPress={startVcpScan}
                  disabled={isAnyScanRunning}
                />
              </View>
              <StyledText
                variant="caption"
                color={colors.secondary[600]}
                style={styles.timestampText}
              >
                {formatTimestamp(currentResult.scanned_at)}
              </StyledText>
              <Divider color={colors.primary[800]} marginVertical={0} />
              <FlatList
                data={currentResult.stocks}
                keyExtractor={(item) => item.symbol}
                renderItem={renderStockItem}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                extraData={[chartCache, comparison]}
              />
            </>
          )}
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
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
  },
  tabBar: {
    flex: 1,
  },
  tabBarContent: {
    flexDirection: "row",
  },
  tab: {
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
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
  errorBox: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "rgba(248, 113, 113, 0.1)",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.negative,
  },
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
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  rsListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  historyBtn: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  timestampText: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    ...Platform.select({
      web: { paddingBottom: 32 },
      default: { paddingBottom: 40 },
    }),
  },
});
