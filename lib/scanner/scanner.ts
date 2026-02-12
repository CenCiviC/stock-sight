import type {
  IndexType,
  OHLCVBar,
  ScanOptions,
  ScanProgress,
  ScanResult,
  Stock,
  SymbolData,
} from "./types";
import { trailingReturn } from "./indicators";
import { getSymbols } from "./symbols";
import { fetchChart, fetchChartBatch } from "./yahoo";
import { computeSymbolData } from "./vcp";

interface SpyReturns {
  r_12m: number;
  r_6m: number;
  r_3m: number;
  r_1m: number;
}

/**
 * Load SPY benchmark returns for relative strength comparison.
 */
export async function loadSpyReturns(
  signal?: AbortSignal
): Promise<SpyReturns> {
  const { bars } = await fetchChart("SPY", 365, signal);
  const closes = bars.map((b) => b.close);

  return {
    r_12m: trailingReturn(closes, 252),
    r_6m: trailingReturn(closes, 126),
    r_3m: trailingReturn(closes, 63),
    r_1m: trailingReturn(closes, 21),
  };
}

/**
 * Calculate percentile rank for each value in an array.
 * Matches pandas rank(pct=True) * 100.
 */
function percentileRank(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  // Create indexed array for sorting
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  // Assign ranks (1-based), handling ties with average rank
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    // Find all items with the same value
    while (j < n && indexed[j].value === indexed[i].value) {
      j++;
    }
    // Average rank for tied values
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].index] = avgRank;
    }
    i = j;
  }

  // Convert to percentile (rank / n * 100)
  return ranks.map((r) => Math.round((r / n) * 100 * 100) / 100);
}

/**
 * Compute RS percentiles and filter symbols that pass all VCP conditions.
 */
export function computePercentilesAndFilter(
  symbolDataMap: Map<string, SymbolData>
): Stock[] {
  const entries = Array.from(symbolDataMap.entries());
  if (entries.length === 0) return [];

  // Current scores
  const scores = entries.map(([, d]) => d.score);
  const percentiles = percentileRank(scores);

  // 5-day-ago scores (only for symbols that have them)
  const entriesWith5d = entries.filter(([, d]) => d.score_5days_ago != null);
  const scores5d = entriesWith5d.map(([, d]) => d.score_5days_ago as number);
  const percentiles5d = percentileRank(scores5d);

  // Build a lookup for 5d percentiles
  const percentile5dMap = new Map<string, number>();
  entriesWith5d.forEach(([sym], i) => {
    percentile5dMap.set(sym, percentiles5d[i]);
  });

  const results: Stock[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [symbol, data] = entries[i];
    const rs_percentile = percentiles[i];
    const rs_percentile_5days_ago = percentile5dMap.get(symbol) ?? rs_percentile;
    const rs_change =
      Math.round((rs_percentile - rs_percentile_5days_ago) * 100) / 100;

    // Filter: all 8 conditions true AND rs_percentile >= 70
    const allConditions =
      data.cond_price_sma_order &&
      data.cond_ma150_above_ma200 &&
      data.cond_ma200_not_declining &&
      data.cond_within_52w_high_range &&
      data.cond_outperform_index &&
      data.cond_volatility_decreasing &&
      data.cond_pullback_within_range &&
      data.cond_volume_decrease_on_pullback;

    if (allConditions && rs_percentile >= 70) {
      results.push({
        symbol,
        close: data.close,
        rs_percentile,
        rs_percentile_5days_ago,
        rs_change,
        returns: {
          r_12m: data.r_12m,
          r_6m: data.r_6m,
          r_3m: data.r_3m,
          r_1m: data.r_1m,
        },
      });
    }
  }

  // Sort by rs_percentile descending
  results.sort((a, b) => b.rs_percentile - a.rs_percentile);

  return results;
}

/**
 * Run the full VCP scan pipeline.
 *
 * Flow:
 * 1. Fetch symbol list for the given index
 * 2. Load SPY benchmark returns
 * 3. Fetch chart data for all symbols
 * 4. Compute VCP conditions and RS scores
 * 5. Calculate percentiles and filter
 */
export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const { index, signal, onProgress } = options;

  const progress = (p: Partial<ScanProgress> & { phase: string }) => {
    onProgress?.({
      current: 0,
      total: 0,
      message: "",
      ...p,
    });
  };

  // Phase 1: Get symbols
  progress({ phase: "symbols", message: "Fetching symbol list..." });
  const symbols = await getSymbols(index);
  console.log(`[scanner] Phase 1: ${symbols.length} symbols fetched for ${index}`);
  if (symbols.length <= 10) {
    console.log(`[scanner] Symbols:`, symbols);
  }

  if (symbols.length === 0) {
    console.warn("[scanner] No symbols found! Check symbol fetching.");
    return { index, count: 0, scanned_at: new Date().toISOString(), stocks: [] };
  }

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 2: Load SPY benchmark
  progress({
    phase: "benchmark",
    message: "Loading SPY benchmark data...",
  });
  const spyReturns = await loadSpyReturns(signal);
  console.log(`[scanner] Phase 2: SPY returns loaded`, spyReturns);

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 3: Scan all symbols
  progress({
    phase: "scanning",
    current: 0,
    total: symbols.length,
    message: `Scanning ${symbols.length} symbols...`,
  });

  const chartResults = await fetchChartBatch(symbols, {
    signal,
    onProgress: (current, total) => {
      progress({
        phase: "scanning",
        current,
        total,
        message: `Scanning ${current}/${total} symbols...`,
      });
    },
  });

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 4: Compute VCP data for each symbol
  progress({
    phase: "computing",
    message: "Computing RS scores and VCP conditions...",
  });

  console.log(`[scanner] Phase 3: ${chartResults.size} charts fetched out of ${symbols.length} symbols`);

  const symbolDataMap = new Map<string, SymbolData>();
  let loggedSamples = 0;

  for (const [symbol, chartData] of chartResults) {
    if (!chartData) continue;

    // Log first 3 symbols for debugging
    if (loggedSamples < 3) {
      console.log(`[scanner] Sample "${symbol}": bars=${chartData.bars.length}, currentPrice=${chartData.currentPrice}`);
      loggedSamples++;
    }

    const data = computeSymbolData(
      chartData.bars,
      spyReturns,
      chartData.currentPrice
    );

    if (data) {
      data.symbol = symbol;
      symbolDataMap.set(symbol, data);
    }
  }

  console.log(`[scanner] Phase 4: ${symbolDataMap.size} symbols computed (${chartResults.size - symbolDataMap.size} failed/insufficient data)`);

  // Log VCP condition pass rates
  if (symbolDataMap.size > 0) {
    const entries = Array.from(symbolDataMap.values());
    const condCounts = {
      price_sma_order: entries.filter((d) => d.cond_price_sma_order).length,
      ma150_above_ma200: entries.filter((d) => d.cond_ma150_above_ma200).length,
      ma200_not_declining: entries.filter((d) => d.cond_ma200_not_declining).length,
      within_52w_high: entries.filter((d) => d.cond_within_52w_high_range).length,
      outperform_index: entries.filter((d) => d.cond_outperform_index).length,
      volatility_decreasing: entries.filter((d) => d.cond_volatility_decreasing).length,
      pullback_within_range: entries.filter((d) => d.cond_pullback_within_range).length,
      volume_decrease: entries.filter((d) => d.cond_volume_decrease_on_pullback).length,
    };
    console.log(`[scanner] VCP condition pass counts (out of ${entries.length}):`, condCounts);
  }

  // Phase 5: Percentiles and filtering
  progress({
    phase: "filtering",
    message: "Calculating percentiles and filtering...",
  });

  const stocks = computePercentilesAndFilter(symbolDataMap);
  console.log(`[scanner] Phase 5: ${stocks.length} stocks passed all filters (8 conditions + RS >= 70)`);

  return {
    index,
    count: stocks.length,
    scanned_at: new Date().toISOString(),
    stocks,
  };
}
