import {
  Badge,
  Button,
  Divider,
  FavoriteCard,
  G1HistoryCard,
  ProgressBar,
  RankingCard,
  SectorChart,
  StockCard,
  StockChart,
  StyledText,
} from "@/components/ui";
import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import { fonts } from "@/constants/typography";
import type {
  AlertFeed,
  AlertItem,
  Ema921Feed,
  Ema921Item,
  G1HistoryEntry,
  G1HistoryFeed,
} from "@/lib/alerts";
import {
  fetchAlertFeed,
  fetchEma921Feed,
  fetchG1History,
  g1Grade,
  TIER_MIN_ATR_RANK,
  TIER_MIN_BELOW_DAYS,
  TIER_MIN_VEXP,
} from "@/lib/alerts";
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

type ActiveView =
  | "rs_top"
  | "nasdaq"
  | "charts"
  | "favorites"
  | "alerts"
  | "ema921";

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
const ALERT_CARD_H = 96;               // Today 카드 (칩 3개 + 미니 차트)
const ALERT_ROW_H = ALERT_CARD_H + spacing.sm;
const ALERT_CHART_W = 112;
const G1_HISTORY_WINDOW_DAYS = 30;     // Today 탭 하단 기본 노출 범위
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** YYYY-MM-DD 문자열을 날짜 연산 없이 비교하려고 N일 전 날짜를 같은 형식으로 만든다 */
function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

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

  // --- Alerts (Today) state ---
  const [alertFeed, setAlertFeed] = useState<AlertFeed | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertCharts, setAlertCharts] = useState<Record<string, OHLCVBar[]>>({});
  const [alertChartsLoading, setAlertChartsLoading] = useState(false);
  const [g1History, setG1History] = useState<G1HistoryFeed | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // --- EMA 9/21 crossover state ---
  const [ema921Feed, setEma921Feed] = useState<Ema921Feed | null>(null);
  const [ema921Loading, setEma921Loading] = useState(false);
  const [ema921Error, setEma921Error] = useState<string | null>(null);
  const [ema921Charts, setEma921Charts] = useState<Record<string, OHLCVBar[]>>(
    {},
  );
  const [ema921ChartsLoading, setEma921ChartsLoading] = useState(false);

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
  const isAlerts = activeView === "alerts";
  const isEma921 = activeView === "ema921";
  const activeTab =
    isRsTop || isFavorites || isCharts || isAlerts || isEma921
      ? null
      : (activeView as IndexType);
  const currentResult = activeTab ? (results[activeTab] ?? null) : null;
  const isScanning = isRsTop
    ? rsScanning
    : activeTab !== null && scanningIndex === activeTab;
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

  // Fetch alert feed (called on tab activation + manual refresh)
  const loadAlertFeed = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    // 히스토리는 부가 정보 — 실패해도 오늘 피드는 보여준다.
    const [feed, history] = await Promise.allSettled([
      fetchAlertFeed(),
      fetchG1History(),
    ]);
    if (feed.status === "fulfilled") {
      setAlertFeed(feed.value);
    } else {
      const e = feed.reason;
      setAlertsError(e instanceof Error ? e.message : "Fetch failed");
    }
    if (history.status === "fulfilled") setG1History(history.value);
    setAlertsLoading(false);
  }, []);

  // 오늘 피드에 이미 있는 신호는 히스토리에서 뺀다 (같은 종목이 두 번 보이지 않게).
  // 피드의 scanDateET는 실행 시각이라 봉 날짜와 하루 어긋날 수 있어 3일 여유를 둔다.
  const historyEntries = useMemo(() => {
    if (!g1History) return { shown: [] as G1HistoryEntry[], olderCount: 0 };
    const todaySyms = new Set(alertFeed?.alerts.map((a) => a.symbol) ?? []);
    const feedDate = alertFeed?.scanDateET ?? "";
    const nearFeed = (d: string) =>
      feedDate !== "" &&
      Math.abs(Date.parse(d) - Date.parse(feedDate)) <= 3 * 86_400_000;
    const all = g1History.entries.filter(
      (e) => !(todaySyms.has(e.symbol) && nearFeed(e.signalDate)),
    );
    const cutoff = daysAgoIso(G1_HISTORY_WINDOW_DAYS);
    const recent = all.filter((e) => e.signalDate >= cutoff);
    return {
      shown: historyExpanded ? all : recent,
      olderCount: all.length - recent.length,
    };
  }, [g1History, alertFeed, historyExpanded]);

  useEffect(() => {
    if (!isAlerts) return;
    void loadAlertFeed();
  }, [isAlerts, loadAlertFeed]);

  // Fetch chart bars for alerts (미니 차트 + 히스토리 수익률 계산)
  useEffect(() => {
    if (!isAlerts) return;
    const wanted = new Set([
      ...(alertFeed?.alerts.map((a) => a.symbol) ?? []),
      ...historyEntries.shown.map((e) => e.symbol),
    ]);
    const missing = [...wanted].filter((sym) => !alertCharts[sym]);
    if (missing.length === 0) return;

    let cancelled = false;
    setAlertChartsLoading(true);
    (async () => {
      const concurrency = 3;
      for (let i = 0; i < missing.length; i += concurrency) {
        if (cancelled) break;
        const batch = missing.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((sym) => fetchChart(sym, 400)),
        );
        if (cancelled) break;
        setAlertCharts((prev) => {
          const next = { ...prev };
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              next[batch[idx]] = result.value.bars;
            }
          });
          return next;
        });
      }
      if (!cancelled) setAlertChartsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAlerts, alertFeed, historyEntries]);

  // Fetch EMA 9/21 feed (called on tab activation + manual refresh)
  const loadEma921Feed = useCallback(async () => {
    setEma921Loading(true);
    setEma921Error(null);
    try {
      const feed = await fetchEma921Feed();
      setEma921Feed(feed);
    } catch (e) {
      setEma921Error(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setEma921Loading(false);
    }
  }, []);

  useEffect(() => {
    if (!isEma921) return;
    void loadEma921Feed();
  }, [isEma921, loadEma921Feed]);

  // Fetch chart bars for EMA 9/21 alerts (2-grid view)
  useEffect(() => {
    if (!isEma921 || !ema921Feed || ema921Feed.alerts.length === 0) return;
    const missing = ema921Feed.alerts
      .map((a) => a.symbol)
      .filter((sym) => !ema921Charts[sym]);
    if (missing.length === 0) return;

    let cancelled = false;
    setEma921ChartsLoading(true);
    (async () => {
      const concurrency = 3;
      for (let i = 0; i < missing.length; i += concurrency) {
        if (cancelled) break;
        const batch = missing.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((sym) => fetchChart(sym, 400)),
        );
        if (cancelled) break;
        setEma921Charts((prev) => {
          const next = { ...prev };
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              next[batch[idx]] = result.value.bars;
            }
          });
          return next;
        });
      }
      if (!cancelled) setEma921ChartsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEma921, ema921Feed]);

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
  // EMA 9/21 탭은 전략에 맞춰 두 EMA만 표시 (SMA 없음)
  const EMA921_EMA = useMemo(() => [9, 21], []);

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

  // Today 카드 — 종목 한 줄 + v20 티어 3표 칩 + 미니 차트.
  // 칩은 값이 임계값을 넘으면 채워진 점, 아니면 빈 점. 값은 미충족이어도
  // 그대로 보여서 "얼마나 모자란지"가 읽힌다. null(봉 부족)은 "—".
  const renderAlertCard = useCallback(
    ({ item }: { item: AlertItem }) => {
      const bars = alertCharts[item.symbol];
      const hasVotes = item.votes != null;
      const chips: { label: string; value: string; on: boolean }[] = [
        {
          label: "역배열",
          value: item.belowDays == null ? "—" : `${item.belowDays}일`,
          on: item.belowDays != null && item.belowDays >= TIER_MIN_BELOW_DAYS,
        },
        {
          label: "ATR%ile",
          value: item.atrRank252 == null ? "—" : item.atrRank252.toFixed(0),
          on: item.atrRank252 != null && item.atrRank252 >= TIER_MIN_ATR_RANK,
        },
        {
          label: "거래량",
          value: item.vexp63 == null ? "—" : `×${item.vexp63.toFixed(2)}`,
          on: item.vexp63 != null && item.vexp63 >= TIER_MIN_VEXP,
        },
      ];
      return (
        <Pressable
          style={styles.alertCard}
          onPress={() =>
            router.push({
              pathname: "/stock/[symbol]",
              params: { symbol: item.symbol },
            })
          }
        >
          <View style={styles.alertCardBody}>
            <View style={styles.alertCardTop}>
              <StyledText
                variant="bodySmall"
                weight="bold"
                color={colors.accent_light[400]}
              >
                {item.symbol}
              </StyledText>
              <StyledText
                variant="caption"
                weight="medium"
                color={colors.secondary[500]}
              >
                ${item.close.toFixed(2)}
              </StyledText>
              {/* G1은 ATR≥6이 진입 자격 — 날짜 대신 변동성을 보여준다 */}
              <StyledText
                variant="caption"
                weight="medium"
                color={colors.accent_warm[300]}
                style={styles.alertCardAtr}
              >
                ATR {item.atrPct.toFixed(1)}%
              </StyledText>
            </View>
            {hasVotes ? (
              <>
                <View style={styles.voteRow}>
                  {chips.map((c) => (
                    <View
                      key={c.label}
                      style={[styles.voteChip, c.on && styles.voteChipOn]}
                    >
                      <View
                        style={[styles.voteDot, c.on && styles.voteDotOn]}
                      />
                      <StyledText
                        variant="caption"
                        weight="semibold"
                        color={c.on ? colors.accent_warm[300] : colors.primary[300]}
                      >
                        {c.label}
                      </StyledText>
                      <StyledText
                        variant="caption"
                        color={c.on ? colors.accent_warm[300] : colors.primary[300]}
                        style={styles.voteValue}
                      >
                        {c.value}
                      </StyledText>
                    </View>
                  ))}
                </View>
                <StyledText
                  variant="caption"
                  weight="semibold"
                  color={colors.accent_light[400]}
                  style={styles.voteCount}
                >
                  {item.votes}/3
                </StyledText>
              </>
            ) : (
              <StyledText variant="caption" color={colors.secondary[600]}>
                티어 표는 다음 스캔부터 표시됩니다
              </StyledText>
            )}
          </View>
          <View style={styles.alertCardChart}>
            {bars && bars.length > 0 ? (
              <StockChart
                bars={bars}
                height={ALERT_CARD_H - spacing.md * 2}
                compact
                maPeriods={CHART_SMA}
                emaPeriods={CHART_EMA}
              />
            ) : null}
          </View>
        </Pressable>
      );
    },
    [alertCharts, router, CHART_SMA, CHART_EMA],
  );

  // Today 탭 하단 "최근 30일 G1" — 신호일별 묶음, 최신 날짜 먼저.
  const historyFooter = useMemo(() => {
    const { shown, olderCount } = historyEntries;
    if (!g1History || (shown.length === 0 && olderCount === 0)) return null;

    const groups: { date: string; items: G1HistoryEntry[] }[] = [];
    for (const e of shown) {
      const last = groups.at(-1);
      if (last && last.date === e.signalDate) last.items.push(e);
      else groups.push({ date: e.signalDate, items: [e] });
    }
    const upCount = shown.filter(
      (e) => g1Grade(e.votes, e.gcDays) === "확대",
    ).length;

    return (
      <View style={styles.historySection}>
        <View style={styles.historyHeader}>
          <StyledText variant="body" weight="bold" color={colors.accent_light[400]}>
            {historyExpanded ? "G1 히스토리" : `최근 ${G1_HISTORY_WINDOW_DAYS}일 G1`}
          </StyledText>
          <StyledText variant="caption" color={colors.secondary[600]}>
            {shown.length}건 · 확대 {upCount}
          </StyledText>
        </View>
        <View style={styles.historyLegend}>
          <StyledText variant="caption" color={colors.secondary[700]}>
            점수 1표씩: 역배열 {TIER_MIN_BELOW_DAYS}일↑ · ATR%ile {TIER_MIN_ATR_RANK}↑
            · 거래량 ×{TIER_MIN_VEXP}↑ (금색 = 충족)
          </StyledText>
          <StyledText variant="caption" color={colors.secondary[700]}>
            진입 = 신호 다음 날 시가 · D+n / 63거래일 · 등급은 백테스트 기반 참고
          </StyledText>
        </View>

        {groups.map((g) => (
          <View key={g.date} style={styles.historyGroup}>
            <View style={styles.historyDateRow}>
              <StyledText
                variant="caption"
                weight="semibold"
                color={colors.secondary[300]}
                style={styles.voteValue}
              >
                {g.date.slice(5)}
              </StyledText>
              <View style={styles.historyDateLine} />
              <StyledText variant="caption" color={colors.secondary[700]}>
                {WEEKDAYS_KO[new Date(`${g.date}T12:00:00Z`).getUTCDay()]}
              </StyledText>
            </View>
            {g.items.map((e) => (
              <G1HistoryCard
                key={`${e.symbol}-${e.signalDate}`}
                entry={e}
                bars={alertCharts[e.symbol]}
                onPress={() =>
                  router.push({
                    pathname: "/stock/[symbol]",
                    params: { symbol: e.symbol },
                  })
                }
              />
            ))}
          </View>
        ))}

        {(olderCount > 0 || historyExpanded) && (
          <Pressable
            style={styles.historyMoreBtn}
            onPress={() => setHistoryExpanded((v) => !v)}
          >
            <StyledText variant="bodySmall" weight="semibold" color={colors.secondary[300]}>
              {historyExpanded
                ? `최근 ${G1_HISTORY_WINDOW_DAYS}일만 보기`
                : `이전 신호 더 보기 (${olderCount}건)`}
            </StyledText>
          </Pressable>
        )}
      </View>
    );
  }, [historyEntries, g1History, historyExpanded, alertCharts, router]);

  const renderEma921ChartItem = useCallback(
    ({ item }: { item: Ema921Item }) => {
      const bars = ema921Charts[item.symbol];
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
                weight="bold"
                color={colors.accent_light[400]}
              >
                {item.symbol}
              </StyledText>
              <StyledText
                variant="caption"
                weight="medium"
                color={colors.secondary[500]}
              >
                ${item.close.toFixed(2)}
              </StyledText>
            </View>
            {/* 전일 대비 변화율 대신 ATR% — 하루 변동폭이 진입 자격을 가른다.
                피드가 아직 구버전이면 atrPct가 없으므로 종전 값으로 되돌린다. */}
            <StyledText
              variant="caption"
              weight="medium"
              color={
                item.atrPct == null
                  ? colors.secondary[600]
                  : item.atrPct >= 4
                    ? colors.accent_warm[300]
                    : colors.secondary[600]
              }
            >
              {item.atrPct != null
                ? `ATR ${item.atrPct.toFixed(1)}%`
                : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(1)}%`}
            </StyledText>
          </View>
          <View style={styles.chartGridChartWrap}>
            {bars && bars.length > 0 ? (
              <StockChart
                bars={bars}
                height={CHART_CELL_H - 24}
                compact
                emaPeriods={EMA921_EMA}
              />
            ) : (
              <View style={styles.chartGridChartWrap} />
            )}
          </View>
        </Pressable>
      );
    },
    [ema921Charts, router, EMA921_EMA],
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

          {/* Today (alerts) tab */}
          <Pressable
            style={[styles.tab, isAlerts && styles.tabActive]}
            onPress={() => setActiveView("alerts")}
          >
            <Ionicons
              name="flash-outline"
              size={14}
              color={isAlerts ? colors.accent_warm[300] : colors.secondary[600]}
            />
            <StyledText
              variant="bodySmall"
              weight={isAlerts ? "bold" : "medium"}
              color={isAlerts ? colors.accent_warm[300] : colors.secondary[600]}
            >
              Today
            </StyledText>
            {alertsLoading ? (
              <View style={styles.tabDotScanning} />
            ) : alertFeed && alertFeed.alerts.length > 0 ? (
              <View style={styles.tabDot} />
            ) : null}
          </Pressable>

          {/* EMA 9/21 crossover tab */}
          <Pressable
            style={[styles.tab, isEma921 && styles.tabActive]}
            onPress={() => setActiveView("ema921")}
          >
            <Ionicons
              name="trending-up-outline"
              size={14}
              color={isEma921 ? colors.accent_warm[300] : colors.secondary[600]}
            />
            <StyledText
              variant="bodySmall"
              weight={isEma921 ? "bold" : "medium"}
              color={isEma921 ? colors.accent_warm[300] : colors.secondary[600]}
            >
              EMA 9/21
            </StyledText>
            {ema921Loading ? (
              <View style={styles.tabDotScanning} />
            ) : ema921Feed && ema921Feed.alerts.length > 0 ? (
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

      {/* === Today (Alerts) View === */}
      {isAlerts && (
        <>
          <View style={styles.alertsHeader}>
            <View style={styles.alertsHeaderLeft}>
              <StyledText variant="h3" color={colors.accent_warm[300]}>
                Today 추천
              </StyledText>
              {alertFeed?.scanDateET && (
                <StyledText
                  variant="caption"
                  color={colors.secondary[500]}
                >
                  {alertFeed.scanDateET} ET · {alertFeed.count}종목
                  {alertFeed.alerts.some((a) => a.votes != null)
                    ? ` · 2표↑ ${alertFeed.alerts.filter((a) => (a.votes ?? 0) >= 2).length}`
                    : ""}
                </StyledText>
              )}
            </View>
            <Pressable
              onPress={() => {
                setAlertCharts({});
                void loadAlertFeed();
              }}
              hitSlop={8}
              style={styles.alertsRefreshBtn}
            >
              <Ionicons
                name="refresh"
                size={16}
                color={colors.secondary[500]}
              />
            </Pressable>
          </View>

          {alertsLoading && !alertFeed && (
            <View style={styles.emptyState}>
              <StyledText variant="bodySmall" color={colors.secondary[500]}>
                Loading alerts...
              </StyledText>
            </View>
          )}

          {alertsError && (
            <View style={styles.emptyState}>
              <Ionicons
                name="alert-circle-outline"
                size={48}
                color={colors.negative}
              />
              <StyledText
                variant="bodySmall"
                color={colors.secondary[500]}
                style={styles.emptyDesc}
              >
                {alertsError}
              </StyledText>
            </View>
          )}

          {alertFeed && (
            <>
              {alertChartsLoading && (
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
                // 득표 내림차순, 같은 표면 ATR 내림차순 (슬롯 경합 우선순위)
                data={[...alertFeed.alerts].sort(
                  (a, b) =>
                    (b.votes ?? 0) - (a.votes ?? 0) || b.atrPct - a.atrPct,
                )}
                keyExtractor={(item) => item.symbol}
                renderItem={renderAlertCard}
                contentContainerStyle={styles.alertList}
                showsVerticalScrollIndicator={false}
                windowSize={3}
                maxToRenderPerBatch={4}
                initialNumToRender={6}
                getItemLayout={(_data, index) => ({
                  length: ALERT_ROW_H,
                  offset: ALERT_ROW_H * index,
                  index,
                })}
                extraData={alertCharts}
                ListEmptyComponent={
                  alertsLoading ? null : (
                    // 히스토리가 바로 보이도록 빈 상태는 한 줄 카드로 줄인다
                    <View style={styles.alertsEmptyCard}>
                      <Ionicons
                        name="moon-outline"
                        size={22}
                        color={colors.primary[300]}
                      />
                      <View style={styles.alertsEmptyText}>
                        <StyledText
                          variant="bodySmall"
                          weight="semibold"
                          color={colors.secondary[200]}
                        >
                          오늘은 새 G1 신호가 없어요
                        </StyledText>
                        <StyledText
                          variant="caption"
                          color={colors.secondary[600]}
                        >
                          다음 스캔: 평일 ET 17:30 · 아래에서 최근 신호를
                          확인하세요
                        </StyledText>
                      </View>
                    </View>
                  )
                }
                ListFooterComponent={historyFooter}
              />
            </>
          )}
        </>
      )}

      {/* === EMA 9/21 Crossover View === */}
      {isEma921 && (
        <>
          <View style={styles.alertsHeader}>
            <View style={styles.alertsHeaderLeft}>
              <StyledText variant="h3" color={colors.accent_warm[300]}>
                EMA 9/21 골든크로스
              </StyledText>
              {ema921Feed?.scanDateET && (
                <StyledText variant="caption" color={colors.secondary[500]}>
                  {ema921Feed.scanDateET} ET · {ema921Feed.count}종목
                </StyledText>
              )}
            </View>
            <Pressable
              onPress={() => {
                setEma921Charts({});
                void loadEma921Feed();
              }}
              hitSlop={8}
              style={styles.alertsRefreshBtn}
            >
              <Ionicons
                name="refresh"
                size={16}
                color={colors.secondary[500]}
              />
            </Pressable>
          </View>

          {ema921Loading && !ema921Feed && (
            <View style={styles.emptyState}>
              <StyledText variant="bodySmall" color={colors.secondary[500]}>
                Loading alerts...
              </StyledText>
            </View>
          )}

          {ema921Error && (
            <View style={styles.emptyState}>
              <Ionicons
                name="alert-circle-outline"
                size={48}
                color={colors.negative}
              />
              <StyledText
                variant="bodySmall"
                color={colors.secondary[500]}
                style={styles.emptyDesc}
              >
                {ema921Error}
              </StyledText>
            </View>
          )}

          {ema921Feed && ema921Feed.alerts.length === 0 && !ema921Loading && (
            <View style={styles.emptyState}>
              <Ionicons
                name="moon-outline"
                size={48}
                color={colors.primary[400]}
              />
              <StyledText
                variant="bodyLarge"
                color={colors.secondary[400]}
                style={styles.emptyTitle}
              >
                오늘은 골든크로스 종목이 없어요
              </StyledText>
              <StyledText
                variant="bodySmall"
                color={colors.secondary[600]}
                style={styles.emptyDesc}
              >
                미국 장 마감 후(평일 ET 17:30) 새 알림이 올라옵니다.
              </StyledText>
            </View>
          )}

          {ema921Feed && ema921Feed.alerts.length > 0 && (
            <>
              {ema921ChartsLoading && (
                <View style={styles.favChartsLoadingRow}>
                  <StyledText variant="caption" color={colors.secondary[500]}>
                    Loading charts...
                  </StyledText>
                </View>
              )}
              <FlatList
                data={ema921Feed.alerts}
                keyExtractor={(item) => item.symbol}
                numColumns={CHART_GRID_COLS}
                renderItem={renderEma921ChartItem}
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
                extraData={ema921Charts}
              />
            </>
          )}
        </>
      )}

      {/* === VCP View === */}
      {!isRsTop && !isFavorites && !isCharts && !isAlerts && !isEma921 && (
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
  // --- Today 카드 (G1 신호 + 티어 3표) ---
  alertList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    ...Platform.select({
      web: { paddingBottom: 32 },
      default: { paddingBottom: 40 },
    }),
  },
  alertCard: {
    height: ALERT_CARD_H,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.md,
    overflow: "hidden",
  },
  alertCardBody: {
    flex: 1,
    gap: spacing.sm,
  },
  alertCardTop: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  alertCardAtr: {
    marginLeft: "auto",
  },
  alertCardChart: {
    width: ALERT_CHART_W,
    height: ALERT_CARD_H - spacing.md * 2,
    overflow: "hidden",
  },
  voteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 1,
  },
  voteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.primary[600],
  },
  voteChipOn: {
    borderColor: "rgba(225, 217, 188, 0.45)",
    backgroundColor: "rgba(225, 217, 188, 0.14)",
  },
  voteDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  voteDotOn: {
    borderWidth: 0,
    backgroundColor: colors.accent_warm[500],
  },
  voteValue: {
    fontFamily: fonts.data,
  },
  voteCount: {
    fontFamily: fonts.data,
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
  alertsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  alertsHeaderLeft: {
    gap: 2,
  },
  alertsRefreshBtn: {
    padding: spacing.xs,
  },
  alertsEmptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary[900],
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary[500],
    borderRadius: borderRadius.lg,
  },
  alertsEmptyText: {
    flex: 1,
    gap: 2,
  },
  historySection: {
    marginTop: spacing["2xl"],
    gap: spacing.md,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  historyLegend: {
    gap: 2,
    paddingHorizontal: spacing.xs,
    marginTop: -spacing.xs,
  },
  historyGroup: {
    gap: spacing.sm,
  },
  historyDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  historyDateLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.primary[700],
  },
  historyMoreBtn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary[500],
    borderRadius: borderRadius.md,
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
