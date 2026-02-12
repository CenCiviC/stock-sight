import type {
  RankedStock,
  RsRankingResult,
  ScanProgress,
  SectorCount,
  SymbolData,
} from "./types";
import { getSymbols } from "./symbols";
import { fetchChartBatch, fetchCompanyProfile } from "./yahoo";
import { computeSymbolData } from "./vcp";
import { loadSpyReturns, percentileRank } from "./scanner";

export interface RsScanOptions {
  topN?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * Compute RS percentiles and return the top N stocks (no VCP filtering).
 */
function computePercentilesTopN(
  symbolDataMap: Map<string, SymbolData>,
  n: number
): Array<{
  symbol: string;
  close: number;
  rs_percentile: number;
  rs_percentile_5days_ago: number;
  rs_change: number;
  returns: { r_12m: number; r_6m: number; r_3m: number; r_1m: number };
}> {
  const entries = Array.from(symbolDataMap.entries());
  if (entries.length === 0) return [];

  // Current scores
  const scores = entries.map(([, d]) => d.score);
  const percentiles = percentileRank(scores);

  // 5-day-ago scores
  const entriesWith5d = entries.filter(([, d]) => d.score_5days_ago != null);
  const scores5d = entriesWith5d.map(([, d]) => d.score_5days_ago as number);
  const percentiles5d = percentileRank(scores5d);

  const percentile5dMap = new Map<string, number>();
  entriesWith5d.forEach(([sym], i) => {
    percentile5dMap.set(sym, percentiles5d[i]);
  });

  const results: Array<{
    symbol: string;
    close: number;
    rs_percentile: number;
    rs_percentile_5days_ago: number;
    rs_change: number;
    returns: { r_12m: number; r_6m: number; r_3m: number; r_1m: number };
  }> = [];

  for (let i = 0; i < entries.length; i++) {
    const [symbol, data] = entries[i];
    const rs_percentile = percentiles[i];
    const rs_percentile_5days_ago =
      percentile5dMap.get(symbol) ?? rs_percentile;
    const rs_change =
      Math.round((rs_percentile - rs_percentile_5days_ago) * 100) / 100;

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

  // Sort by rs_percentile descending, take top N
  results.sort((a, b) => b.rs_percentile - a.rs_percentile);
  return results.slice(0, n);
}

/**
 * Run RS-only scan on S&P 500.
 * Same Phase 1-4 as VCP scanner, but Phase 5 takes top N by RS only,
 * and Phase 6 fetches sector info for the top stocks.
 */
export async function runRsScan(
  options: RsScanOptions = {}
): Promise<RsRankingResult> {
  const { topN = 100, signal, onProgress } = options;

  const progress = (p: Partial<ScanProgress> & { phase: string }) => {
    onProgress?.({
      current: 0,
      total: 0,
      message: "",
      ...p,
    });
  };

  // Phase 1: Get S&P 500 symbols
  progress({ phase: "symbols", message: "Fetching S&P 500 symbol list..." });
  const symbols = await getSymbols("sp500");
  console.log(
    `[rs-scanner] Phase 1: ${symbols.length} symbols fetched for S&P 500`
  );

  if (symbols.length === 0) {
    return { count: 0, scanned_at: new Date().toISOString(), stocks: [], sectors: [] };
  }

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 2: Load SPY benchmark
  progress({ phase: "benchmark", message: "Loading SPY benchmark data..." });
  const spyReturns = await loadSpyReturns(signal);
  console.log(`[rs-scanner] Phase 2: SPY returns loaded`);

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 3: Fetch chart data
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

  // Phase 4: Compute RS scores
  progress({ phase: "computing", message: "Computing RS scores..." });

  const symbolDataMap = new Map<string, SymbolData>();
  const nameMap = new Map<string, string>();
  for (const [symbol, chartData] of chartResults) {
    if (!chartData) continue;
    if (chartData.shortName) {
      nameMap.set(symbol, chartData.shortName);
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

  console.log(
    `[rs-scanner] Phase 4: ${symbolDataMap.size} symbols computed`
  );

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 5: Top N by RS percentile
  progress({ phase: "ranking", message: "Ranking by RS percentile..." });
  const topStocks = computePercentilesTopN(symbolDataMap, topN);
  console.log(
    `[rs-scanner] Phase 5: Top ${topStocks.length} stocks selected`
  );

  if (signal?.aborted) throw new Error("Scan aborted");

  // Phase 6: Fetch sector info for top stocks
  progress({
    phase: "sectors",
    current: 0,
    total: topStocks.length,
    message: `Fetching sector info (0/${topStocks.length})...`,
  });

  const sectorMap = new Map<string, string>();
  const concurrency = 5;
  let completed = 0;

  for (let i = 0; i < topStocks.length; i += concurrency) {
    if (signal?.aborted) throw new Error("Scan aborted");

    const batch = topStocks.slice(i, i + concurrency);
    const promises = batch.map(async (stock) => {
      try {
        const profile = await fetchCompanyProfile(stock.symbol, signal);
        sectorMap.set(stock.symbol, profile.sector || "Unknown");
      } catch {
        sectorMap.set(stock.symbol, "Unknown");
      }
    });
    await Promise.all(promises);
    completed += batch.length;

    progress({
      phase: "sectors",
      current: completed,
      total: topStocks.length,
      message: `Fetching sector info (${completed}/${topStocks.length})...`,
    });
  }

  // Build ranked stocks with sector info
  const rankedStocks: RankedStock[] = topStocks.map((stock, idx) => ({
    rank: idx + 1,
    symbol: stock.symbol,
    name: nameMap.get(stock.symbol) ?? "",
    close: stock.close,
    rs_percentile: stock.rs_percentile,
    rs_percentile_5days_ago: stock.rs_percentile_5days_ago,
    rs_change: stock.rs_change,
    sector: sectorMap.get(stock.symbol) ?? "Unknown",
    returns: stock.returns,
  }));

  // Compute sector distribution
  const sectorCounts = new Map<string, number>();
  for (const stock of rankedStocks) {
    sectorCounts.set(stock.sector, (sectorCounts.get(stock.sector) ?? 0) + 1);
  }
  const sectors: SectorCount[] = Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count);

  return {
    count: rankedStocks.length,
    scanned_at: new Date().toISOString(),
    stocks: rankedStocks,
    sectors,
  };
}
