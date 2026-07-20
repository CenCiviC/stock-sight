#!/usr/bin/env tsx
/**
 * US Stock Scanner — two signals, one pass over NASDAQ 5000 symbols.
 *
 * Bars are fetched once per symbol and fed to both detectors:
 *
 *   1) EMA9 / SMA50  → data/alerts/latest.json   (app's "Today" tab)
 *        previous days (5+ consecutive):  EMA9 / SMA50 < 1.0
 *        current day:                     EMA9 / SMA50 >= 0.95
 *                                         AND Close >= SMA200 * 0.95
 *
 *   2) EMA9 / EMA21  → data/alerts/ema921.json   (app's "EMA 9/21" tab)
 *        Port of TradingView `ta.crossover(ema9, ema21)`:
 *        yesterday EMA9 <= EMA21  AND  today EMA9 > EMA21
 *        Liquidity filters only (price / volume) — no trend filter.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const ENTRY_RATIO_THRESHOLD = 0.95;   // 당일 EMA9/SMA50 >= 0.95 (SMA50 95% 이상)
const OUTSIDE_RATIO_THRESHOLD = 1.0;  // daysOutside 카운팅 (EMA9 < SMA50)
const SMA200_THRESHOLD = 0.95;        // 당일 Close >= SMA200 * 0.95
const MIN_PRICE = 5;           // 최소 종가 필터 ($5 미만 제외)
const MIN_AVG_VOLUME = 500_000; // 최근 10일 평균 거래량 (>=500K)
const VOLUME_LOOKBACK = 10;     // 거래량 평균 기간
const CONCURRENCY = 5;         // parallel Yahoo Finance requests
const DELAY_MS = 200;          // ms between each batch
const RETRY_MAX = 3;           // retries on 429 / network error
const MIN_BARS = 210;          // minimum bars needed (SMA200 + buffer)

const EMA_FAST = 9;            // EMA 9/21 전략의 단기선
const EMA_SLOW = 21;           // EMA 9/21 전략의 장기선

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

const OUTSIDE_RANGE_MIN_DAYS = 5; // 진입 전 최소 연속 범위 밖 일수

interface ScanResult {
  symbol: string;
  close: number;
  ema9: number;
  prevEma9: number;
  sma50: number;
  sma200: number;
  ratio: number;
  daysOutside: number; // 오늘 진입 전 연속으로 범위 밖에 있던 일수
  avgVolume10: number; // 최근 10일 평균 거래량

  // --- EMA 9/21 전략 (SMA 시딩 EMA, TradingView와 동일) ---
  emaFast: number;      // EMA9
  emaSlow: number;      // EMA21
  ema921Cross: boolean; // 오늘 EMA9이 EMA21을 상향 돌파했는지
  gapPct: number;       // (EMA9 - EMA21) / EMA21 * 100
  changePct: number;    // 전일 종가 대비 변화율 (%)
}

function isCrossover(r: ScanResult): boolean {
  // 1) 직전 최소 5일 연속 ratio < 1.0 (EMA9가 SMA50 아래에 있었음)
  // 2) 당일: ratio >= 0.95 (오늘 SMA50의 95% 이상까지 올라옴)
  // 3) 오늘 EMA9 > 전날 EMA9 (상승 중)
  // 4) 오늘 종가 >= SMA200 * 0.95 (장기 추세선 95% 이상)
  // 5) 최근 10일 평균 거래량 >= 500K (유동성 필터)
  return (
    r.daysOutside >= OUTSIDE_RANGE_MIN_DAYS &&
    r.ratio >= ENTRY_RATIO_THRESHOLD &&
    r.ema9 > r.prevEma9 &&
    r.close >= r.sma200 * SMA200_THRESHOLD &&
    r.avgVolume10 >= MIN_AVG_VOLUME
  );
}

/**
 * EMA 9/21 매수 신호 (TradingView "EMA 9/21 with Target Price [SS]").
 *
 * 원본 지표의 신호는 `ta.crossover(ema9, ema21)` 하나뿐이다.
 * 여기에 유동성 필터(종가/거래량)만 추가하고, 추세 필터(SMA200)는 걸지 않는다.
 */
function isEma921Signal(r: ScanResult): boolean {
  return (
    r.ema921Cross &&
    r.close >= MIN_PRICE &&
    r.avgVolume10 >= MIN_AVG_VOLUME
  );
}

// ──────────────────────────────────────────────
// Indicators
// ──────────────────────────────────────────────

/** Exponential Moving Average (adjust=False, same as pandas ewm) */
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * EMA seeded with the SMA of the first `period` closes — matches Pine's `ta.ema`
 * (and lib/scanner/indicators.ts rollingEMA), unlike calcEMA above which seeds
 * with closes[0]. Returns null before the seed window completes.
 */
function calcEMASeeded(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let ema = sum / period;
  out[period - 1] = ema;

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** Simple Moving Average — returns null for first (period-1) elements */
function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    return sum / period;
  });
}

// ──────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = RETRY_MAX
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, init);

    if (resp.status === 429 && attempt < retries) {
      const wait = 1000 * 2 ** attempt; // 1s, 2s, 4s
      console.warn(`[fetch] 429 rate-limit — retrying in ${wait}ms (${url.slice(0, 60)}...)`);
      await sleep(wait);
      continue;
    }

    return resp;
  }
  // Should never reach here but TypeScript needs it
  throw new Error("fetchWithRetry exhausted");
}

// ──────────────────────────────────────────────
// NASDAQ Symbols
// ──────────────────────────────────────────────

async function fetchNasdaqSymbols(): Promise<string[]> {
  const url =
    "https://api.nasdaq.com/api/screener/stocks" +
    "?tableonly=true&limit=5000&sortcolumn=marketcap&sortorder=desc";

  const resp = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": BROWSER_UA,
    },
  });

  if (!resp.ok) {
    throw new Error(`NASDAQ API HTTP ${resp.status}`);
  }

  const json = (await resp.json()) as { data?: { table?: { rows?: Array<{ symbol?: string }> } } };
  const rows: Array<{ symbol?: string }> = json?.data?.table?.rows ?? [];

  const seen = new Set<string>();
  const symbols: string[] = [];

  for (const row of rows) {
    // Normalize: "." → "-" (Yahoo Finance convention for BRK.B etc.)
    const sym = (row.symbol ?? "")
      .replace(/\./g, "-")
      .replace(/\//g, "-")
      .trim()
      .toUpperCase();

    // Skip empty, index symbols (^), or already seen
    if (!sym || sym.startsWith("^") || seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
  }

  return symbols;
}

// ──────────────────────────────────────────────
// Yahoo Finance
// ──────────────────────────────────────────────

interface DailyBar {
  close: number;
  volume: number;
}

/**
 * Fetch close prices and volume from Yahoo Finance v8 chart API.
 * Returns null if the symbol has insufficient data or doesn't exist.
 */
async function fetchBars(symbol: string): Promise<DailyBar[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1y&interval=1d`;

  let resp: Response;
  try {
    resp = await fetchWithRetry(url, { headers: { "User-Agent": BROWSER_UA } });
  } catch (e) {
    console.warn(`[${symbol}] Network error: ${e}`);
    return null;
  }

  // 404/422 = symbol not listed on Yahoo Finance
  if (resp.status === 404 || resp.status === 422) return null;

  if (!resp.ok) {
    throw new Error(`Yahoo Finance HTTP ${resp.status} for ${symbol}`);
  }

  type YahooChartJson = {
    chart?: {
      result?: Array<{
        indicators?: {
          quote?: Array<{
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
    };
  };
  const json = (await resp.json()) as YahooChartJson;
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const rawVolumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

  const bars: DailyBar[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    const v = rawVolumes[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({ close: c, volume: v != null && Number.isFinite(v) ? v : 0 });
  }

  return bars.length >= MIN_BARS ? bars : null;
}

// ──────────────────────────────────────────────
// Scanner Core
// ──────────────────────────────────────────────

async function scanSymbol(symbol: string): Promise<ScanResult | null> {
  const bars = await fetchBars(symbol);
  if (!bars) return null;

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const ema9 = calcEMA(closes, 9);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);

  const todayEMA9 = ema9.at(-1)!;
  const todaySMA50 = sma50.at(-1);
  const todaySMA200 = sma200.at(-1);
  const prevEMA9 = ema9.at(-2)!;
  const prevSMA50 = sma50.at(-2);

  if (todaySMA50 == null || prevSMA50 == null || todaySMA50 === 0 || prevSMA50 === 0) {
    return null;
  }
  if (todaySMA200 == null || todaySMA200 === 0) {
    return null;
  }

  // 어제부터 거슬러 올라가며 연속으로 ratio < 1.0 (SMA50 아래)인 일수 카운트
  let daysOutside = 0;
  for (let i = 2; i < ema9.length; i++) {
    const e = ema9.at(-i)!;
    const s = sma50.at(-i);
    if (s == null || s === 0) break;
    if (e / s < OUTSIDE_RATIO_THRESHOLD) {
      daysOutside++;
    } else {
      break; // 연속 streak 끊김
    }
  }

  // --- EMA 9/21 크로스오버 (Pine ta.crossover 그대로) ---
  const emaFastArr = calcEMASeeded(closes, EMA_FAST);
  const emaSlowArr = calcEMASeeded(closes, EMA_SLOW);

  const fastToday = emaFastArr.at(-1);
  const slowToday = emaSlowArr.at(-1);
  const fastPrev = emaFastArr.at(-2);
  const slowPrev = emaSlowArr.at(-2);

  const hasEmaPair =
    fastToday != null && slowToday != null && fastPrev != null && slowPrev != null;

  // crossover: 어제 fast <= slow, 오늘 fast > slow
  const ema921Cross =
    hasEmaPair && fastPrev <= slowPrev && fastToday > slowToday;

  const prevClose = closes.at(-2);

  // 최근 10일 평균 거래량
  const recentVols = volumes.slice(-VOLUME_LOOKBACK);
  const avgVolume10 =
    recentVols.length > 0
      ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length
      : 0;

  return {
    symbol,
    close: closes.at(-1)!,
    ema9: todayEMA9,
    prevEma9: prevEMA9,
    sma50: todaySMA50,
    sma200: todaySMA200,
    ratio: todayEMA9 / todaySMA50,
    daysOutside,
    avgVolume10,
    emaFast: hasEmaPair ? fastToday : 0,
    emaSlow: hasEmaPair ? slowToday : 0,
    ema921Cross,
    gapPct:
      hasEmaPair && slowToday !== 0
        ? ((fastToday - slowToday) / slowToday) * 100
        : 0,
    changePct:
      prevClose != null && prevClose !== 0
        ? (closes.at(-1)! / prevClose - 1) * 100
        : 0,
  };
}

// ──────────────────────────────────────────────
// Concurrency Pool
// ──────────────────────────────────────────────

interface BatchRunResult {
  results: ScanResult[];
  errors: string[];
}

async function runBatch(
  symbols: string[],
  onProgress?: (done: number, total: number) => void
): Promise<BatchRunResult> {
  const results: ScanResult[] = [];
  const errors: string[] = [];
  let done = 0;
  const total = symbols.length;

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);

    const settled = await Promise.allSettled(batch.map((sym) => scanSymbol(sym)));

    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        if (s.value != null) results.push(s.value);
      } else {
        console.warn(`[${batch[j]}] Scan failed: ${s.reason}`);
        errors.push(batch[j]);
      }
      done++;
    }

    onProgress?.(done, total);

    if (i + CONCURRENCY < symbols.length) {
      await sleep(DELAY_MS);
    }
  }

  return { results, errors };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Fetch NASDAQ symbols
  console.log("Fetching NASDAQ symbols...");
  let symbols: string[];
  try {
    symbols = await fetchNasdaqSymbols();
    console.log(`Fetched ${symbols.length} symbols`);
  } catch (e) {
    console.error("Failed to fetch NASDAQ symbols:", e);
    process.exit(1);
  }

  // 2. Scan all symbols
  console.log(`Scanning ${symbols.length} symbols for EMA9/SMA50 crossover...`);

  let lastLog = 0;
  const { results, errors } = await runBatch(symbols, (done, total) => {
    // Log every 250 symbols to avoid noise
    if (done - lastLog >= 250 || done === total) {
      console.log(`  Progress: ${done}/${total}`);
      lastLog = done;
    }
  });

  // 3. Filter to crossover symbols only, sort by daysOutside asc (최신 크로스오버 먼저)
  const crossed = results
    .filter(isCrossover)
    .filter((r) => r.close >= MIN_PRICE)
    .sort((a, b) => a.daysOutside - b.daysOutside);

  // 3b. EMA 9/21 골든크로스, 거래량 큰 순으로 정렬
  const ema921 = results
    .filter(isEma921Signal)
    .sort((a, b) => b.avgVolume10 - a.avgVolume10);

  console.log(
    `Scan complete — total: ${symbols.length}, ` +
      `crossovers: ${crossed.length}, ema9/21: ${ema921.length}, ` +
      `errors: ${errors.length}`
  );

  if (crossed.length > 0) {
    console.log("Crossover symbols:", crossed.map((r) => r.symbol).join(", "));
  }
  if (ema921.length > 0) {
    console.log("EMA 9/21 symbols:", ema921.map((r) => r.symbol).join(", "));
  }

  // 4. Write JSON for app consumption (data/alerts/*.json)
  writeAlertsJson(crossed, symbols.length);
  writeEma921Json(ema921, symbols.length);

  console.log("Done.");
}

/** 미국 동부 기준 스캔 날짜 (YYYY-MM-DD) */
function scanDateET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** data/alerts/<filename> 에 payload 기록 (scanner.ts 기준 ../data/alerts) */
function writeAlertFile(filename: string, payload: unknown, count: number): void {
  const outDir = resolve(process.cwd(), "..", "data", "alerts");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, filename);
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${count} alerts)`);
}

function writeAlertsJson(crossed: ScanResult[], total: number): void {
  const slim = crossed.map((r) => ({
    symbol: r.symbol,
    close: Number(r.close.toFixed(4)),
    ema9: Number(r.ema9.toFixed(4)),
    sma50: Number(r.sma50.toFixed(4)),
    sma200: Number(r.sma200.toFixed(4)),
    ratio: Number(r.ratio.toFixed(4)),
    daysOutside: r.daysOutside,
  }));

  writeAlertFile(
    "latest.json",
    {
      scannedAt: new Date().toISOString(),
      scanDateET: scanDateET(),
      total,
      count: slim.length,
      alerts: slim,
    },
    slim.length
  );
}

function writeEma921Json(crossed: ScanResult[], total: number): void {
  const slim = crossed.map((r) => ({
    symbol: r.symbol,
    close: Number(r.close.toFixed(4)),
    ema9: Number(r.emaFast.toFixed(4)),
    ema21: Number(r.emaSlow.toFixed(4)),
    gapPct: Number(r.gapPct.toFixed(2)),
    changePct: Number(r.changePct.toFixed(2)),
    avgVolume10: Math.round(r.avgVolume10),
  }));

  writeAlertFile(
    "ema921.json",
    {
      scannedAt: new Date().toISOString(),
      scanDateET: scanDateET(),
      total,
      count: slim.length,
      alerts: slim,
    },
    slim.length
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
