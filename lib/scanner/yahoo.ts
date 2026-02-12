import type { OHLCVBar, QuarterlyFinancial } from "./types";
import { proxyUrl } from "./proxy";

export interface ChartResult {
  bars: OHLCVBar[];
  currentPrice: number;
}

export interface FetchChartBatchOptions {
  days?: number;
  concurrency?: number;
  delayMs?: number;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Map a number of days to a Yahoo Finance range string.
 */
function daysToRange(days: number): string {
  // Python yfinance "400d" = 400 calendar days ≈ 280 trading days.
  // We need 252+ trading days for MA200 + 52-week high, so use "2y" for safety.
  if (days >= 1800) return "5y";
  if (days >= 365) return "2y";
  if (days >= 180) return "1y";
  if (days >= 90) return "6mo";
  if (days >= 30) return "3mo";
  if (days >= 7) return "5d";
  return "1d";
}

/**
 * Fetch OHLCV chart data for a single symbol from Yahoo Finance v8 API.
 */
export async function fetchChart(
  symbol: string,
  days: number = 400,
  signal?: AbortSignal
): Promise<ChartResult> {
  const range = daysToRange(days);
  const rawUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=1d`;
  const url = proxyUrl(rawUrl);

  const resp = await fetch(url, { signal });

  if (!resp.ok) {
    throw new Error(`Yahoo Finance HTTP ${resp.status} for ${symbol}`);
  }

  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart data for ${symbol}`);
  }

  const meta = result.meta ?? {};
  const currentPrice: number =
    meta.regularMarketPrice ?? meta.previousClose ?? 0;

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const bars: OHLCVBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    // Skip bars with null values
    if (o == null || h == null || l == null || c == null || v == null) {
      continue;
    }

    const date = new Date(timestamps[i] * 1000);
    const dateStr =
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0");

    bars.push({
      date: dateStr,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
    });
  }

  return { bars, currentPrice };
}

/**
 * Utility: sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch chart data for multiple symbols with concurrency control.
 *
 * - Processes up to `concurrency` symbols in parallel (default: 3)
 * - Adds `delayMs` between batches (default: 100ms)
 * - Supports AbortSignal for cancellation
 * - Skips failed symbols (logs warning, continues)
 * - Reports progress via optional callback
 */
export async function fetchChartBatch(
  symbols: string[],
  options: FetchChartBatchOptions = {}
): Promise<Map<string, ChartResult>> {
  const {
    days = 400,
    concurrency = 3,
    delayMs = 100,
    signal,
    onProgress,
  } = options;

  const results = new Map<string, ChartResult>();
  let completed = 0;
  const total = symbols.length;

  for (let i = 0; i < symbols.length; i += concurrency) {
    if (signal?.aborted) {
      break;
    }

    const batch = symbols.slice(i, i + concurrency);
    const promises = batch.map(async (sym) => {
      try {
        const result = await fetchChart(sym, days, signal);
        results.set(sym, result);
      } catch (e) {
        console.warn(`[yahoo] Failed to fetch ${sym}:`, e);
      }
    });

    await Promise.all(promises);
    completed += batch.length;

    if (onProgress) {
      onProgress(Math.min(completed, total), total);
    }

    // Delay between batches (skip after the last batch)
    if (i + concurrency < symbols.length && delayMs > 0 && !signal?.aborted) {
      await sleep(delayMs);
    }
  }

  return results;
}

/**
 * Yahoo Finance crumb management.
 * The v10 quoteSummary API requires a crumb + cookie for authentication.
 * Flow: fc.yahoo.com (sets cookies) → getcrumb endpoint → use crumb in API calls.
 * Cookies are managed server-side by the metro proxy's cookie jar.
 */
let crumbCache: { crumb: string; ts: number } | null = null;
const CRUMB_TTL = 5 * 60 * 1000; // 5 minutes

async function getYahooCrumb(signal?: AbortSignal): Promise<string> {
  if (crumbCache && Date.now() - crumbCache.ts < CRUMB_TTL) {
    return crumbCache.crumb;
  }

  // Step 1: Hit fc.yahoo.com to establish session cookies (proxy stores them)
  await fetch(proxyUrl("https://fc.yahoo.com/"), { signal }).catch(() => {});

  // Step 2: Get crumb using the stored cookies
  const resp = await fetch(
    proxyUrl("https://query2.finance.yahoo.com/v1/test/getcrumb"),
    { signal }
  );
  if (!resp.ok) {
    throw new Error(`Failed to get Yahoo crumb: HTTP ${resp.status}`);
  }

  const crumb = await resp.text();
  if (!crumb || crumb.length > 50) {
    throw new Error("Invalid Yahoo crumb received");
  }

  crumbCache = { crumb, ts: Date.now() };
  return crumb;
}

/**
 * Fetch quarterly income statement data for a symbol from Yahoo Finance v10 API.
 * Returns the most recent 5 quarters of revenue and net income.
 */
export async function fetchFinancials(
  symbol: string,
  signal?: AbortSignal
): Promise<QuarterlyFinancial[]> {
  let crumb = await getYahooCrumb(signal);

  const buildUrl = (c: string) =>
    proxyUrl(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=incomeStatementHistoryQuarterly&crumb=${encodeURIComponent(c)}`
    );

  let resp = await fetch(buildUrl(crumb), { signal });

  // If 401, refresh crumb and retry once
  if (resp.status === 401) {
    crumbCache = null;
    crumb = await getYahooCrumb(signal);
    resp = await fetch(buildUrl(crumb), { signal });
  }

  if (!resp.ok) {
    throw new Error(`Yahoo Finance HTTP ${resp.status} for ${symbol}`);
  }

  const json = await resp.json();
  const statements =
    json?.quoteSummary?.result?.[0]?.incomeStatementHistoryQuarterly
      ?.incomeStatementHistory;

  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error(`No financial data for ${symbol}`);
  }

  const quarters: QuarterlyFinancial[] = statements
    .map((stmt: any) => {
      const endDate: string | undefined = stmt.endDate?.fmt; // "YYYY-MM-DD"
      const revenue: number | undefined = stmt.totalRevenue?.raw;
      const netIncome: number | undefined = stmt.netIncome?.raw;

      if (!endDate || revenue == null || netIncome == null) return null;

      // Convert date to quarter label: "2024-Q3"
      const [yearStr, monthStr] = endDate.split("-");
      const month = parseInt(monthStr, 10);
      const quarter = Math.ceil(month / 3);

      return {
        date: `${yearStr}-Q${quarter}`,
        revenue,
        netIncome,
      };
    })
    .filter((q: QuarterlyFinancial | null): q is QuarterlyFinancial => q !== null)
    .reverse() // oldest first
    .slice(-5); // most recent 5 quarters

  return quarters;
}
