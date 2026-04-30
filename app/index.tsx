import {
  Badge,
  Button,
  Divider,
  FavoriteCard,
  ProgressBar,
  RankingCard,
  SectorChart,
  StockCard,
  StockChart,
  StyledText,
} from "@/components/ui";
import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import type { ComparisonResult, FavoriteRecord, RankChange } from "@/lib/db";
import {
  addFavorite,
  compareRankings,
  compareScanResults,
  getAllFavorites,
  getFavoritedSymbols,
  getLatestChartGrid,
  getLatestRsRanking,
  getLatestScan,
  getPreviousScan,
  removeFavorite,
  saveChartGrid,
  saveRsRanking,
  saveScan,
} from "@/lib/db";
import { queryClient, queryKeys } from "@/lib/queries";
import type {
  ChartResult,
  IndexType,
  OHLCVBar,
  RankedStock,
  RsRankingResult,
  ScanProgress,
  ScanResult,
  SectorCount,
  Stock,
} from "@/lib/scanner";
import {
  fetchChart,
  fetchChartBatch,
  fetchNasdaqSymbolsByMarketCap,
  rollingSMA,
  runRsScan,
  runScan,
} from "@/lib/scanner";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ActiveView = "rs_top" | "nasdaq" | "charts" | "favorites";

const VCP_TABS: { key: IndexType; label: string }[] = [
  { key: "nasdaq", label: "NASDAQ" },
];

type ChartGridItem = {
  symbol: string;
  bars: OHLCVBar[];
  market_cap_rank: number;
};

const CHART_GRID_COLS = 2;
const CHART_CELL_H = 140;
// Row height for getItemLayout: cell height + vertical margin (xs * 2)
const CHART_ROW_H = CHART_CELL_H + 8;

export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();

  const [activeView, setActiveView] = useState<ActiveView>("rs_top");
  const [searchInput, setSearchInput] = useState("");

  const handleSearch = () => {
    const trimmed = searchInput.trim().toUpperCase();
    if (!trimmed) return;
    setSearchInput("");
    router.push({
      pathname: "/stock/[symbol]",
      params: { symbol: trimmed },
    });
  };

  // --- VCP scan state ---
  const [results, setResults] = useState<
    Partial<Record<IndexType, ScanResult>>
  >({});
  const [comparisons, setComparisons] = useState<
    Partial<Record<IndexType, ComparisonResult>>
  >({});
  const [scanningIndex, setScanningIndex] = useState<IndexType | null>(null);

  // --- RS ranking state ---
  const [rsResult, setRsResult] = useState<RsRankingResult | null>(null);
  const [rsRankChanges, setRsRankChanges] = useState<Map<string, RankChange>>(
    new Map(),
  );
  const [rsPrevSectors, setRsPrevSectors] = useState<SectorCount[]>([]);
  const [rsScanning, setRsScanning] = useState(false);

  // --- Favorites state ---
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [favoritedSymbols, setFavoritedSymbols] = useState<Set<string>>(
    new Set(),
  );
  const [favCurrentPrices, setFavCurrentPrices] = useState<
    Record<string, number>
  >({});
  const [favPricesLoading, setFavPricesLoading] = useState(false);
  const [favViewMode, setFavViewMode] = useState<"cards" | "charts">("cards");
  const [favCharts, setFavCharts] = useState<Record<string, OHLCVBar[]>>({});
  const [favChartsLoading, setFavChartsLoading] = useState(false);

  // --- Chart Grid state ---
  const [chartGridItems, setChartGridItems] = useState<ChartGridItem[]>([]);
  const [chartGridLoading, setChartGridLoading] = useState(false);
  const [chartGridTotal, setChartGridTotal] = useState(0);
  const [chartGridLoaded, setChartGridLoaded] = useState(0);
  const [visibleTopRank, setVisibleTopRank] = useState<number | null>(null);
  const chartGridAbortRef = useRef<AbortController | null>(null);

  // --- Shared state ---
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [dbLoaded, setDbLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Chart preload tracking
  const chartLoadingRef = useRef(false);
  const [chartCacheVersion, setChartCacheVersion] = useState(0);

  const isRsTop = activeView === "rs_top";
  const isFavorites = activeView === "favorites";
  const isCharts = activeView === "charts";
  const activeTab =
    isRsTop || isFavorites || isCharts ? null : (activeView as IndexType);
  const currentResult = activeTab ? (results[activeTab] ?? null) : null;
  const isScanning = isRsTop
    ? rsScanning
    : !isFavorites && !isCharts && scanningIndex === activeTab;
  const isAnyScanRunning = scanningIndex !== null || rsScanning;

  // Load latest data from DB on mount
  useEffect(() => {
    (async () => {
      const loaded: Partial<Record<IndexType, ScanResult>> = {};
      const loadedComparisons: Partial<Record<IndexType, ComparisonResult>> =
        {};
      for (const tab of VCP_TABS) {
        const record = await getLatestScan(db, tab.key);
        if (record) {
          loaded[tab.key] = {
            index: record.index_type,
            count: record.count,
            scanned_at: record.scanned_at,
            stocks: record.stocks,
          };
          const prev = await getPreviousScan(db, tab.key);
          if (prev) {
            loadedComparisons[tab.key] = compareScanResults(
              record.stocks,
              prev.stocks,
            );
          }
        }
      }
      setResults(loaded);
      setComparisons(loadedComparisons);

      // Load favorites
      const favs = await getAllFavorites(db);
      setFavorites(favs);
      const favSyms = await getFavoritedSymbols(db);
      setFavoritedSymbols(favSyms);

      // Load chart grid
      const chartGridRecord = await getLatestChartGrid(db);
      if (chartGridRecord) {
        setChartGridItems(chartGridRecord.items);
      }

      // Load RS ranking
      const rsRecord = await getLatestRsRanking(db);
      if (rsRecord) {
        // Reconstruct sectors from stocks
        const sectorCounts = new Map<string, number>();
        for (const stock of rsRecord.stocks) {
          sectorCounts.set(
            stock.sector,
            (sectorCounts.get(stock.sector) ?? 0) + 1,
          );
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
        const comparison = compareScanResults(
          scanResult.stocks,
          previousScan.stocks,
        );
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
    chartGridAbortRef.current?.abort();
  }, []);

  // Load chart grid: fetch NASDAQ by market cap, filter by SMA200
  const loadChartGrid = useCallback(async () => {
    if (chartGridLoading) return;

    setChartGridLoading(true);
    setChartGridItems([]);
    setChartGridLoaded(0);
    setError(null);

    const controller = new AbortController();
    chartGridAbortRef.current = controller;

    try {
      const symbols = await fetchNasdaqSymbolsByMarketCap();
      if (controller.signal.aborted) return;

      setChartGridTotal(symbols.length);

      const chartResults = await fetchChartBatch(symbols, {
        days: 400,
        concurrency: 3,
        delayMs: 100,
        signal: controller.signal,
        onProgress: (loaded) => setChartGridLoaded(loaded),
      });

      if (controller.signal.aborted) return;

      const rankBySymbol = new Map<string, number>();
      symbols.forEach((sym, i) => rankBySymbol.set(sym, i + 1));

      const newItems: ChartGridItem[] = [];
      for (const [symbol, { bars }] of chartResults) {
        if (bars.length < 2) continue;

        const closes = bars.map((b) => b.close);
        const sma200 = rollingSMA(closes, 200);
        const lastSma = sma200[sma200.length - 1];
        const lastClose = closes[closes.length - 1];

        if (lastSma === null || lastClose > lastSma) {
          newItems.push({
            symbol,
            bars,
            market_cap_rank: rankBySymbol.get(symbol) ?? 0,
          });
        }
      }

      newItems.sort((a, b) => a.market_cap_rank - b.market_cap_rank);

      setChartGridItems(newItems);
      await saveChartGrid(db, newItems);
    } catch (e) {
      if (
        (e as Error).message !== "Scan aborted" &&
        !(e as Error).message?.includes("abort")
      ) {
        setError(e instanceof Error ? e.message : "Failed to load charts");
      }
    } finally {
      setChartGridLoading(false);
      chartGridAbortRef.current = null;
    }
  }, [chartGridLoading, db]);

  // Toggle favorite for a stock
  const toggleFavorite = useCallback(
    async (stock: Stock, sourceIndex: string) => {
      if (favoritedSymbols.has(stock.symbol)) {
        await removeFavorite(db, stock.symbol);
        setFavoritedSymbols((prev) => {
          const next = new Set(prev);
          next.delete(stock.symbol);
          return next;
        });
        setFavorites((prev) => prev.filter((f) => f.symbol !== stock.symbol));
      } else {
        await addFavorite(db, stock, sourceIndex);
        setFavoritedSymbols((prev) => new Set(prev).add(stock.symbol));
        const updated = await getAllFavorites(db);
        setFavorites(updated);
      }
    },
    [db, favoritedSymbols],
  );

  // Fetch current prices when favorites tab is active
  useEffect(() => {
    if (!isFavorites || favorites.length === 0) return;

    let cancelled = false;
    setFavPricesLoading(true);

    (async () => {
      const concurrency = 5;
      const symbols = favorites.map((f) => f.symbol);

      for (let i = 0; i < symbols.length; i += concurrency) {
        if (cancelled) break;
        const batch = symbols.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((sym) => fetchChart(sym, 7)),
        );

        if (cancelled) break;
        setFavCurrentPrices((prev) => {
          const next = { ...prev };
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              next[batch[idx]] = result.value.currentPrice;
            }
          });
          return next;
        });
      }

      if (!cancelled) setFavPricesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isFavorites, favorites]);

  // Fetch chart bars for favorites when chart view mode is active
  useEffect(() => {
    if (!isFavorites || favViewMode !== "charts" || favorites.length === 0)
      return;

    const missing = favorites
      .map((f) => f.symbol)
      .filter((sym) => !favCharts[sym]);
    if (missing.length === 0) return;

    let cancelled = false;
    setFavChartsLoading(true);

    (async () => {
      const concurrency = 3;
      for (let i = 0; i < missing.length; i += concurrency) {
        if (cancelled) break;
        const batch = missing.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((sym) => fetchChart(sym, 400)),
        );
        if (cancelled) break;
        setFavCharts((prev) => {
          const next = { ...prev };
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              next[batch[idx]] = result.value.bars;
            }
          });
          return next;
        });
      }
      if (!cancelled) setFavChartsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFavorites, favViewMode, favorites]);

  // Load 1M chart data for VCP scan results → store in React Query cache
  useEffect(() => {
    if (!currentResult || currentResult.stocks.length === 0) return;
    if (chartLoadingRef.current) return;

    const symbols = currentResult.stocks
      .map((s) => s.symbol)
      .filter((sym) => !queryClient.getQueryData(queryKeys.chart(sym, 30)));

    if (symbols.length === 0) return;

    chartLoadingRef.current = true;

    (async () => {
      const concurrency = 5;

      for (let i = 0; i < symbols.length; i += concurrency) {
        const batch = symbols.slice(i, i + concurrency);
        const promises = batch.map(async (sym) => {
          try {
            const result = await fetchChart(sym, 30);
            queryClient.setQueryData(queryKeys.chart(sym, 30), result);
          } catch {
            // skip failed
          }
        });
        await Promise.all(promises);
      }

      setChartCacheVersion((v) => v + 1);
      chartLoadingRef.current = false;
    })();
  }, [currentResult]);

  // Derive chartCache from React Query cache
  const chartCache = useMemo(() => {
    const cache: Record<string, OHLCVBar[]> = {};
    if (currentResult) {
      for (const s of currentResult.stocks) {
        const data = queryClient.getQueryData<ChartResult>(
          queryKeys.chart(s.symbol, 30),
        );
        if (data) cache[s.symbol] = data.bars;
      }
    }
    return cache;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentResult, chartCacheVersion]);

  // Precompute VCP comparison lookups
  const comparison = activeTab ? comparisons[activeTab] : undefined;
  const newSymbolSet = useMemo(
    () => new Set(comparison?.new_entries.map((s) => s.symbol) ?? []),
    [comparison],
  );
  const commonMap = useMemo(
    () => new Map(comparison?.common.map((c) => [c.symbol, c]) ?? []),
    [comparison],
  );

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const CHART_SMA = useMemo(() => [50], []);
  const CHART_EMA = useMemo(() => [9], []);

  useEffect(() => {
    if (chartGridItems.length === 0) {
      setVisibleTopRank(null);
    } else {
      setVisibleTopRank((prev) => prev ?? chartGridItems[0].market_cap_rank);
    }
  }, [chartGridItems]);

  const chartViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onChartViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: { item: ChartGridItem }[];
    }) => {
      if (viewableItems.length === 0) return;
      let min = Infinity;
      for (const v of viewableItems) {
        if (v.item.market_cap_rank < min) min = v.item.market_cap_rank;
      }
      if (min !== Infinity) setVisibleTopRank(min);
    },
  ).current;

  const toggleChartFavorite = useCallback(
    async (item: ChartGridItem) => {
      const closes = item.bars.map((b) => b.close);
      const lastClose = closes[closes.length - 1] ?? 0;
      const stock: Stock = {
        symbol: item.symbol,
        close: lastClose,
        rs_percentile: 0,
        rs_percentile_5days_ago: 0,
        rs_change: 0,
        returns: { r_12m: 0, r_6m: 0, r_3m: 0, r_1m: 0 },
      };
      await toggleFavorite(stock, "charts");
    },
    [toggleFavorite],
  );

  const renderChartGridItem = useCallback(
    ({ item }: { item: ChartGridItem }) => {
      const isFav = favoritedSymbols.has(item.symbol);
      return (
        <Pressable
          style={styles.chartGridCell}
          onPress={() =>
            router.push({
              pathname: "/stock/[symbol]",
              params: { symbol: item.symbol },
            })
          }
        >
          <View style={styles.chartGridCellHeader}>
            <View style={styles.chartCellHeaderLeft}>
              <StyledText
                variant="caption"
                weight="medium"
                color={colors.secondary[500]}
              >
                #{item.market_cap_rank}
              </StyledText>
              <StyledText
                variant="caption"
                weight="bold"
                color={colors.accent_light[400]}
              >
                {item.symbol}
              </StyledText>
            </View>
            <Pressable
              onPress={() => toggleChartFavorite(item)}
              hitSlop={8}
            >
              <Ionicons
                name={isFav ? "star" : "star-outline"}
                size={14}
                color={
                  isFav ? colors.accent_warm[300] : colors.secondary[600]
                }
              />
            </Pressable>
          </View>
          <View style={styles.chartGridChartWrap}>
            <StockChart
              bars={item.bars}
              height={CHART_CELL_H - 24}
              compact
              maPeriods={CHART_SMA}
              emaPeriods={CHART_EMA}
            />
          </View>
        </Pressable>
      );
    },
    [router, CHART_SMA, CHART_EMA, favoritedSymbols, toggleChartFavorite],
  );

  const renderFavChartItem = useCallback(
    ({ item }: { item: FavoriteRecord }) => {
      const bars = favCharts[item.symbol];
      if (!bars || bars.length === 0) return null;
      return (
        <Pressable
          style={styles.chartGridCell}
          onPress={() =>
            router.push({
              pathname: "/stock/[symbol]",
              params: { symbol: item.symbol },
            })
          }
        >
          <View style={styles.chartGridCellHeader}>
            <StyledText
              variant="caption"
              weight="bold"
              color={colors.accent_light[400]}
            >
              {item.symbol}
            </StyledText>
            <Pressable
              onPress={() =>
                toggleFavorite(
                  {
                    symbol: item.symbol,
                    close: item.close,
                    rs_percentile: item.rs_percentile,
                    rs_percentile_5days_ago: 0,
                    rs_change: item.rs_change,
                    returns: item.returns,
                  },
                  item.source_index,
                )
              }
              hitSlop={8}
            >
              <Ionicons
                name="star"
                size={14}
                color={colors.accent_warm[300]}
              />
            </Pressable>
          </View>
          <View style={styles.chartGridChartWrap}>
            <StockChart
              bars={bars}
              height={CHART_CELL_H - 24}
              compact
              maPeriods={CHART_SMA}
              emaPeriods={CHART_EMA}
            />
          </View>
        </Pressable>
      );
    },
    [favCharts, router, CHART_SMA, CHART_EMA, toggleFavorite],
  );

  const renderStockItem = ({ item }: { item: Stock }) => {
    let badge = null;
    if (comparison) {
      if (newSymbolSet.has(item.symbol)) {
        badge = <Badge label="NEW" variant="info" />;
      } else {
        const common = commonMap.get(item.symbol);
        if (common && common.rs_delta > 0) {
          badge = (
            <Badge
              label={`RS +${common.rs_delta.toFixed(1)}`}
              variant="success"
            />
          );
        } else if (common && common.rs_delta < 0) {
          badge = (
            <Badge
              label={`RS ${common.rs_delta.toFixed(1)}`}
              variant="danger"
            />
          );
        }
      }
    }

    return (
      <StockCard
        stock={item}
        chartBars={chartCache[item.symbol]}
        badge={badge}
        isFavorited={favoritedSymbols.has(item.symbol)}
        onToggleFavorite={() => toggleFavorite(item, activeTab!)}
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

      {/* Tab Header */}
      <View style={styles.tabRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={styles.tabBarContent}
        >
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

          {/* NASDAQ VCP tab */}
          {VCP_TABS.map((tab) => {
            const isActive = activeView === tab.key;
            const hasResult = !!results[tab.key];
            const isBusy = scanningIndex === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveView(tab.key as ActiveView)}
              >
                <StyledText
                  variant="bodySmall"
                  weight={isActive ? "bold" : "medium"}
                  color={
                    isActive ? colors.accent_warm[300] : colors.secondary[600]
                  }
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

          {/* Charts tab */}
          <Pressable
            style={[styles.tab, isCharts && styles.tabActive]}
            onPress={() => setActiveView("charts")}
          >
            <Ionicons
              name="grid-outline"
              size={14}
              color={isCharts ? colors.accent_warm[300] : colors.secondary[600]}
            />
            <StyledText
              variant="bodySmall"
              weight={isCharts ? "bold" : "medium"}
              color={isCharts ? colors.accent_warm[300] : colors.secondary[600]}
            >
              Charts
            </StyledText>
            {chartGridLoading ? (
              <View style={styles.tabDotScanning} />
            ) : chartGridItems.length > 0 ? (
              <View style={styles.tabDot} />
            ) : null}
          </Pressable>

          {/* Favorites tab */}
          <Pressable
            style={[styles.tab, isFavorites && styles.tabActive]}
            onPress={() => setActiveView("favorites")}
          >
            <Ionicons
              name={isFavorites ? "star" : "star-outline"}
              size={14}
              color={
                isFavorites ? colors.accent_warm[300] : colors.secondary[600]
              }
            />
            <StyledText
              variant="bodySmall"
              weight={isFavorites ? "bold" : "medium"}
              color={
                isFavorites ? colors.accent_warm[300] : colors.secondary[600]
              }
            >
              Favorites
            </StyledText>
            {favorites.length > 0 && <View style={styles.tabDot} />}
          </Pressable>
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
          <Ionicons
            name="time-outline"
            size={20}
            color={colors.secondary[500]}
          />
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
              <StyledText
                variant="h2"
                color={colors.primary[400]}
                style={styles.emptyIcon}
              >
                ?
              </StyledText>
              <StyledText
                variant="bodyLarge"
                color={colors.secondary[400]}
                style={styles.emptyTitle}
              >
                No RS rankings yet
              </StyledText>
              <StyledText
                variant="bodySmall"
                color={colors.secondary[600]}
                style={styles.emptyDesc}
              >
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
                      <StyledText
                        variant="caption"
                        color={colors.secondary[600]}
                      >
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
                      <SectorChart
                        sectors={rsResult.sectors}
                        prevSectors={
                          rsPrevSectors.length > 0 ? rsPrevSectors : undefined
                        }
                        total={rsResult.count}
                      />
                    )}
                  </>
                }
              />
            </>
          )}
        </>
      )}

      {/* === Favorites View === */}
      {isFavorites && !isScanning && (
        <>
          {favorites.length === 0 && dbLoaded && (
            <View style={styles.emptyState}>
              <Ionicons
                name="star-outline"
                size={48}
                color={colors.primary[400]}
              />
              <StyledText
                variant="bodyLarge"
                color={colors.secondary[400]}
                style={styles.emptyTitle}
              >
                No favorites yet
              </StyledText>
              <StyledText
                variant="bodySmall"
                color={colors.secondary[600]}
                style={styles.emptyDesc}
              >
                Tap the star icon on any stock card to save it here
              </StyledText>
            </View>
          )}

          {favorites.length > 0 && (
            <>
              <View style={styles.favViewToggle}>
                <Pressable
                  style={[
                    styles.favToggleBtn,
                    favViewMode === "cards" && styles.favToggleBtnActive,
                  ]}
                  onPress={() => setFavViewMode("cards")}
                >
                  <Ionicons
                    name="list"
                    size={16}
                    color={
                      favViewMode === "cards"
                        ? colors.accent_warm[300]
                        : colors.secondary[500]
                    }
                  />
                </Pressable>
                <Pressable
                  style={[
                    styles.favToggleBtn,
                    favViewMode === "charts" && styles.favToggleBtnActive,
                  ]}
                  onPress={() => setFavViewMode("charts")}
                >
                  <Ionicons
                    name="grid"
                    size={16}
                    color={
                      favViewMode === "charts"
                        ? colors.accent_warm[300]
                        : colors.secondary[500]
                    }
                  />
                </Pressable>
              </View>

              {favViewMode === "cards" && (
                <FlatList
                  data={favorites}
                  keyExtractor={(item) => item.symbol}
                  renderItem={({ item }) => (
                    <FavoriteCard
                      favorite={item}
                      currentPrice={favCurrentPrices[item.symbol] ?? null}
                      isLoadingPrice={
                        favPricesLoading && !(item.symbol in favCurrentPrices)
                      }
                      onRemove={() =>
                        toggleFavorite(
                          {
                            symbol: item.symbol,
                            close: item.close,
                            rs_percentile: item.rs_percentile,
                            rs_percentile_5days_ago: 0,
                            rs_change: item.rs_change,
                            returns: item.returns,
                          },
                          item.source_index,
                        )
                      }
                      onPress={() =>
                        router.push({
                          pathname: "/stock/[symbol]",
                          params: {
                            symbol: item.symbol,
                            data: JSON.stringify({
                              symbol: item.symbol,
                              close: item.close,
                              rs_percentile: item.rs_percentile,
                              rs_percentile_5days_ago: 0,
                              rs_change: item.rs_change,
                              returns: item.returns,
                            }),
                          },
                        })
                      }
                    />
                  )}
                  contentContainerStyle={styles.list}
                  showsVerticalScrollIndicator={false}
                  extraData={[favCurrentPrices, favPricesLoading]}
                />
              )}

              {favViewMode === "charts" && (
                <>
                  {favChartsLoading && (
                    <View style={styles.favChartsLoadingRow}>
                      <StyledText
                        variant="caption"
                        color={colors.secondary[500]}
                      >
                        Loading charts...
                      </StyledText>
                    </View>
                  )}
                  <FlatList
                    data={favorites}
                    keyExtractor={(item) => item.symbol}
                    numColumns={CHART_GRID_COLS}
                    renderItem={renderFavChartItem}
                    contentContainerStyle={styles.chartGridList}
                    showsVerticalScrollIndicator={false}
                    windowSize={3}
                    maxToRenderPerBatch={4}
                    initialNumToRender={6}
                    getItemLayout={(_data, index) => ({
                      length: CHART_ROW_H,
                      offset:
                        CHART_ROW_H * Math.floor(index / CHART_GRID_COLS),
                      index,
                    })}
                    extraData={favCharts}
                  />
                </>
              )}
            </>
          )}
        </>
      )}

      {/* === Charts Grid View === */}
      {isCharts && (
        <>
          {chartGridItems.length === 0 && !chartGridLoading && (
            <View style={styles.emptyState}>
              <Ionicons
                name="grid-outline"
                size={48}
                color={colors.primary[400]}
              />
              <StyledText
                variant="bodyLarge"
                color={colors.secondary[400]}
                style={styles.emptyTitle}
              >
                NASDAQ Chart Grid
              </StyledText>
              <StyledText
                variant="bodySmall"
                color={colors.secondary[600]}
                style={styles.emptyDesc}
              >
                Load NASDAQ stocks by market cap, filtered above SMA 200
              </StyledText>
              <Button
                title="Load Charts"
                variant="primary"
                size="lg"
                onPress={loadChartGrid}
                style={styles.scanBtn}
              />
            </View>
          )}

          {chartGridLoading && (
            <View style={styles.scanningSection}>
              <ProgressBar
                progress={
                  chartGridTotal > 0 ? chartGridLoaded / chartGridTotal : 0
                }
                label={`Loading charts... ${chartGridLoaded}/${chartGridTotal}`}
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

          {chartGridItems.length > 0 && (
            <>
              {!chartGridLoading && (
                <View style={styles.chartGridHeader}>
                  <StyledText variant="caption" color={colors.secondary[600]}>
                    {chartGridItems.length} stocks above SMA 200
                  </StyledText>
                  <Button
                    title="Reload"
                    variant="secondary"
                    size="sm"
                    onPress={loadChartGrid}
                  />
                </View>
              )}
              <View style={styles.chartGridListWrap}>
                <FlatList
                  data={chartGridItems}
                  keyExtractor={(item) => item.symbol}
                  numColumns={CHART_GRID_COLS}
                  renderItem={renderChartGridItem}
                  contentContainerStyle={styles.chartGridList}
                  showsVerticalScrollIndicator={false}
                  windowSize={3}
                  maxToRenderPerBatch={4}
                  initialNumToRender={6}
                  getItemLayout={(_data, index) => ({
                    length: CHART_ROW_H,
                    offset: CHART_ROW_H * Math.floor(index / CHART_GRID_COLS),
                    index,
                  })}
                  viewabilityConfig={chartViewabilityConfig}
                  onViewableItemsChanged={onChartViewableItemsChanged}
                />
                {visibleTopRank !== null && (
                  <View
                    style={styles.rankIndicator}
                    pointerEvents="none"
                  >
                    <StyledText
                      variant="caption"
                      weight="bold"
                      color={colors.accent_warm[300]}
                    >
                      #{visibleTopRank}
                    </StyledText>
                  </View>
                )}
              </View>
            </>
          )}
        </>
      )}

      {/* === VCP View === */}
      {!isRsTop && !isFavorites && !isCharts && (
        <>
          {/* No result → show scan prompt */}
          {!currentResult && !isScanning && dbLoaded && (
            <View style={styles.emptyState}>
              <StyledText
                variant="h2"
                color={colors.primary[400]}
                style={styles.emptyIcon}
              >
                ?
              </StyledText>
              <StyledText
                variant="bodyLarge"
                color={colors.secondary[400]}
                style={styles.emptyTitle}
              >
                No scan results yet
              </StyledText>
              <StyledText
                variant="bodySmall"
                color={colors.secondary[600]}
                style={styles.emptyDesc}
              >
                Scan {VCP_TABS.find((t) => t.key === activeTab)?.label} to find
                stocks matching VCP conditions
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
                  {currentResult.count} stock
                  {currentResult.count !== 1 ? "s" : ""} found
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.accent_light[400],
    fontFamily: "Inter",
    fontSize: 14,
    padding: 0,
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
  chartGridListWrap: {
    flex: 1,
  },
  chartGridList: {
    padding: spacing.sm,
    ...Platform.select({
      web: { paddingBottom: 32 },
      default: { paddingBottom: 40 },
    }),
  },
  rankIndicator: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary[900],
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.primary[700],
  },
  chartGridHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chartGridCell: {
    flex: 1,
    height: CHART_CELL_H,
    margin: spacing.xs,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.md,
    overflow: "hidden",
  },
  chartCellHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  favViewToggle: {
    flexDirection: "row",
    alignSelf: "flex-end",
    marginRight: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.sm,
    overflow: "hidden",
  },
  favToggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  favToggleBtnActive: {
    backgroundColor: colors.primary[700],
  },
  favChartsLoadingRow: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  chartGridCellHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: 2,
  },
  chartGridChartWrap: {
    flex: 1,
    overflow: "hidden",
  },
});
