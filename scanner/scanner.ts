#!/usr/bin/env tsx
/**
 * US Stock Scanner — three signals, one pass over NASDAQ 5000 symbols.
 *
 * Bars are fetched once per symbol and fed to all detectors:
 *
 *   1) G1           → data/alerts/g1.json        (app's "Today" tab)
 *        stock-quant's validated explosive-mover rule
 *        (docs/explosive_hunt_v1.md — 10y sim CAGR +33%):
 *        EMA9/21 golden cross today AND ATR%(20) >= 6
 *        AND prior decline >= 30% (252d high → subsequent low)
 *        AND >= 63 bars since the 252d low  AND close within +5% of EMA21.
 *        Universe: top 2000 by market cap only — widening to 5000 was
 *        falsified (small-cap signals crowd out the good ones) — plus
 *        $5 price, $10M/day 50d dollar volume, China/HK ADRs excluded.
 *
 *   2) EMA9 / SMA50  → data/alerts/latest.json   (legacy feed)
 *        previous days (5+ consecutive):  EMA9 / SMA50 < 1.0
 *        current day:                     EMA9 / SMA50 >= 0.95
 *                                         AND Close >= SMA200 * 0.95
 *
 *   3) EMA9 / EMA21  → data/alerts/ema921.json   (app's "EMA 9/21" tab)
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

// --- G1 rule (stock-quant docs/explosive_hunt_v1.md, v11에서 임계값 확정) ---
const G1_UNIVERSE_TOP = 2000;      // 시총 상위 2000만 — 5000 확장은 검증에서 붕괴
const G1_MIN_ATR_PCT = 6;          // atr_pct_20d >= 6
const G1_MIN_DECLINE_PCT = 30;     // 252일 고점 → 이후 저점 드로다운 >= 30%
const G1_MIN_BASE_DAYS = 63;       // 252일 저점 이후 경과 봉수 >= 63
const G1_MAX_EXT_PCT = 5;          // (close/EMA21 - 1)*100 <= 5
const G1_MIN_DOLLAR_VOL = 10_000_000; // 50일 평균 거래대금 >= $10M
const G1_WINDOW = 252;             // 52주 창
const G1_MIN_BARS = 260;           // 252일 창 + 여유

/** 중국/홍콩 ADR — 승률 36%/대패율 36%로 검증에서 제외 확정 (stock-quant meta.csv) */
const CHINA_ADR = new Set([
  "ATAT", "BABA", "BEKE", "BIDU", "BILI", "BZ", "EDU", "FUTU", "GDS", "GRAB",
  "HTHT", "IQ", "JD", "KC", "LI", "MAAS", "MNSO", "NIO", "NTES", "PDD", "PONY",
  "PUK", "QFIN", "RGC", "RLX", "SIMO", "TAL", "TCOM", "TIGR", "TME", "VIPS",
  "VNET", "XPEV", "YMM", "ZTO",
]);

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
  atrPct: number;       // ATR(20) / 종가 * 100 — "평소 하루에 몇 % 움직이나"

  // --- G1 지표 (봉 부족 시 null — "미달"과 "판정불가"는 다른 사실) ---
  declinePct: number | null;   // 252일 고점 → 이후 최저 저가 드로다운 %
  baseDays: number | null;     // 252일 최저 저가 이후 경과 봉수
  extPct: number | null;       // (close / EMA21 - 1) * 100
  dollarVol50: number | null;  // 50일 평균 거래대금 (close × volume)
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
/**
 * G1 매수 신호 — stock-quant에서 10년 검증된 폭발주 룰.
 * 시총 상위 2000 제한은 호출부(main)에서 rank로 거른다.
 */
function isG1Signal(r: ScanResult): boolean {
  return (
    r.ema921Cross &&
    !CHINA_ADR.has(r.symbol) &&
    r.close >= MIN_PRICE &&
    r.atrPct >= G1_MIN_ATR_PCT &&
    r.declinePct != null && r.declinePct >= G1_MIN_DECLINE_PCT &&
    r.baseDays != null && r.baseDays >= G1_MIN_BASE_DAYS &&
    r.extPct != null && r.extPct <= G1_MAX_EXT_PCT &&
    r.dollarVol50 != null && r.dollarVol50 >= G1_MIN_DOLLAR_VOL
  );
}

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
  high: number;
  low: number;
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
    `?range=2y&interval=1d`; // G1의 252일 창 + 여유 (1y로는 52주 지표가 항상 미달)

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
            high?: (number | null)[];
            low?: (number | null)[];
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

  const q = result.indicators?.quote?.[0];
  const rawCloses: (number | null)[] = q?.close ?? [];
  const rawVolumes: (number | null)[] = q?.volume ?? [];
  const rawHighs: (number | null)[] = q?.high ?? [];
  const rawLows: (number | null)[] = q?.low ?? [];

  const bars: DailyBar[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    const v = rawVolumes[i];
    if (c == null || !Number.isFinite(c)) continue;
    // Yahoo occasionally omits high/low on a bar that has a close. Falling back
    // to the close makes that bar's true range 0 rather than dropping the bar,
    // which would silently shorten the ATR window.
    const h = rawHighs[i];
    const l = rawLows[i];
    bars.push({
      high: h != null && Number.isFinite(h) ? h : c,
      low: l != null && Number.isFinite(l) ? l : c,
      close: c,
      volume: v != null && Number.isFinite(v) ? v : 0,
    });
  }

  return bars.length >= MIN_BARS ? bars : null;
}

// ──────────────────────────────────────────────
// Scanner Core
// ──────────────────────────────────────────────

/**
 * ATR(20) as a percentage of price — the volatility measure the spec's entry
 * gate uses. Wilder's true range, simple 20-bar mean, matching
 * signals/indicators.py in stock-quant so both sides report the same number.
 */
function calcAtrPct(bars: DailyBar[], period = 20): number {
  if (bars.length < period + 1) return 0;
  const tr: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].close;
    tr.push(
      Math.max(
        b.high - b.low,
        Math.abs(b.high - prevClose),
        Math.abs(b.low - prevClose)
      )
    );
  }
  const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
  const close = bars.at(-1)!.close;
  return close > 0 ? (atr / close) * 100 : 0;
}

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
    atrPct: calcAtrPct(bars),
    ...calcG1Metrics(bars, emaSlowArr),
  };
}

/**
 * G1 지표 4종 — stock-quant signals/indicators.py의 정의를 그대로 이식.
 * 봉이 252 + 여유(G1_MIN_BARS) 미만이면 전부 null: "조건 미달"과
 * "역사 부족으로 판정 불가"가 같은 false로 뭉개지면 안 된다.
 */
function calcG1Metrics(
  bars: DailyBar[],
  ema21Arr: (number | null)[],
): Pick<ScanResult, "declinePct" | "baseDays" | "extPct" | "dollarVol50"> {
  const n = bars.length;
  const ema21 = ema21Arr.at(-1);
  if (n < G1_MIN_BARS || ema21 == null || ema21 <= 0) {
    return { declinePct: null, baseDays: null, extPct: null, dollarVol50: null };
  }

  const win = bars.slice(n - G1_WINDOW);

  // prior_decline_pct: 창 내 최고 고가(첫 등장) → 그 이후 최저 저가의 드로다운.
  let peak = -Infinity;
  let peakAt = 0;
  for (let i = 0; i < win.length; i++) {
    if (win[i].high > peak) {
      peak = win[i].high;
      peakAt = i;
    }
  }
  let trough = Infinity;
  for (let i = peakAt; i < win.length; i++) {
    if (win[i].low < trough) trough = win[i].low;
  }
  const declinePct = peak > 0 ? (1 - trough / peak) * 100 : null;

  // days_since_52w_low: 창 내 최저 저가(첫 등장)로부터의 경과 봉수.
  let lowVal = Infinity;
  let lowAt = 0;
  for (let i = 0; i < win.length; i++) {
    if (win[i].low < lowVal) {
      lowVal = win[i].low;
      lowAt = i;
    }
  }
  const baseDays = win.length - 1 - lowAt;

  // dist_to_ema_21_pct (SMA 시딩 EMA21 기준 — python rolling_ema와 동일)
  const close = bars.at(-1)!.close;
  const extPct = (close / ema21 - 1) * 100;

  // 50일 평균 거래대금
  const dv = bars.slice(-50);
  const dollarVol50 =
    dv.reduce((a, b) => a + b.close * b.volume, 0) / dv.length;

  return {
    declinePct,
    baseDays,
    extPct: Number.isFinite(extPct) ? extPct : null,
    dollarVol50,
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
  if (process.env.TEST_SYMBOLS) {
    // 로컬 검증용: TEST_SYMBOLS="NVDA,RGTI,KOD" npx tsx scanner.ts
    symbols = process.env.TEST_SYMBOLS.split(",").map((s: string) =>
      s.trim().toUpperCase(),
    );
    console.log(`TEST_SYMBOLS override: ${symbols.length} symbols`);
  } else {
    try {
      symbols = await fetchNasdaqSymbols();
      console.log(`Fetched ${symbols.length} symbols`);
    } catch (e) {
      console.error("Failed to fetch NASDAQ symbols:", e);
      process.exit(1);
    }
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

  // 3c. G1 — 시총 상위 2000 안에서만 (symbols는 시총 내림차순).
  //     ATR 내림차순 정렬: 포트폴리오 시뮬의 슬롯 경합 우선순위와 동일.
  const rank = new Map(symbols.map((s, i) => [s, i]));
  const g1 = results
    .filter((r) => (rank.get(r.symbol) ?? Infinity) < G1_UNIVERSE_TOP)
    .filter(isG1Signal)
    .sort((a, b) => b.atrPct - a.atrPct);

  if (process.env.TEST_SYMBOLS) {
    // 지표 정합성 검증용 덤프 (stock-quant python 구현과 대조)
    for (const r of results) {
      console.log(
        `  ${r.symbol}: close=${r.close.toFixed(2)} atr=${r.atrPct.toFixed(2)}% ` +
          `decl=${r.declinePct?.toFixed(1)}% base=${r.baseDays}d ` +
          `ext=${r.extPct?.toFixed(2)}% dv50=${((r.dollarVol50 ?? 0) / 1e6).toFixed(1)}M ` +
          `cross=${r.ema921Cross}`,
      );
    }
  }

  console.log(
    `Scan complete — total: ${symbols.length}, ` +
      `g1: ${g1.length}, crossovers: ${crossed.length}, ema9/21: ${ema921.length}, ` +
      `errors: ${errors.length}`
  );
  if (g1.length > 0) {
    console.log("G1 symbols:", g1.map((r) => r.symbol).join(", "));
  }

  if (crossed.length > 0) {
    console.log("Crossover symbols:", crossed.map((r) => r.symbol).join(", "));
  }
  if (ema921.length > 0) {
    console.log("EMA 9/21 symbols:", ema921.map((r) => r.symbol).join(", "));
  }

  // 4. Write JSON for app consumption (data/alerts/*.json)
  writeG1Json(g1, symbols.length);
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

function writeG1Json(signals: ScanResult[], total: number): void {
  const slim = signals.map((r) => ({
    symbol: r.symbol,
    close: Number(r.close.toFixed(4)),
    ema9: Number(r.emaFast.toFixed(4)),
    ema21: Number(r.emaSlow.toFixed(4)),
    atrPct: Number(r.atrPct.toFixed(2)),
    declinePct: Number((r.declinePct ?? 0).toFixed(1)),
    baseDays: r.baseDays ?? 0,
    extPct: Number((r.extPct ?? 0).toFixed(2)),
  }));

  writeAlertFile(
    "g1.json",
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
    atrPct: Number(r.atrPct.toFixed(2)),
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
