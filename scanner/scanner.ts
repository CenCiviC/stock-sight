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
 *        Each signal also carries the v20 tier votes (below-days /
 *        ATR%-self-rank / volume-expansion) so the app can show which
 *        of the three sizing conditions it meets.
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// --- 봉 지연 방어 ---
// Yahoo는 장 마감 몇 시간 뒤에도 일부(때로는 전부) 종목의 당일 일봉을 빼고
// 준다. 그대로 쓰면 전날 봉을 "오늘 신호"로 기록하게 되므로, 세션 날짜보다
// 오래된 봉은 다시 받아 보고, 끝까지 밀린 종목은 신호에서 뺀다.
const STALE_RETRY_ROUNDS = 3;          // 밀린 종목 재요청 횟수
const STALE_RETRY_WAIT_MS = 90_000;    // 재요청 전 대기
const STALE_MAX_RATIO = 0.03;          // 이보다 많이 밀리면 결과를 쓰지 않고 실패

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

// --- v20 티어 3표 (stock-quant explosive_hunt_v1.md v20) ---
// 셋 중 2표 이상이면 백테스트에서 대패율이 절반 이하로 떨어졌다.
// 진입 조건이 아니라 "얼마나 실을지"의 근거 — 표시만 하고 걸러내지 않는다.
const TIER_MIN_BELOW_DAYS = 14;    // 크로스 직전 EMA9<EMA21 지속 봉수 >= 14
const TIER_MIN_ATR_RANK = 60;      // ATR%의 자기 252봉 백분위 >= 60
const TIER_MIN_VEXP = 1.15;        // 50일 평균 거래대금 / 63봉 전 >= 1.15
const ATR_PERIOD = 20;
const TIER_MIN_BARS = G1_WINDOW + ATR_PERIOD; // ATR% 252개가 전부 유효하려면

// --- G1 히스토리 (app Today 탭 "최근 30일") ---
// g1.json은 매 스캔 통째로 덮어써서 하루만 보인다. 신호를 누적해 두는 별도 파일.
const G1_HISTORY_KEEP_DAYS = 120;  // 63거래일 보유(~90일) + 여유

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

  // --- v20 티어 3표 재료 (봉 부족 시 null) ---
  belowDays: number | null;    // 크로스 직전 EMA9<EMA21 연속 봉수 (오늘 제외)
  atrRank252: number | null;   // 오늘 ATR%의 최근 252봉 내 백분위 (0~100)
  vexp63: number | null;       // dollarVol50 / 63봉 전 dollarVol50

  /** SMA50이 SMA200 위로 올라선 지 몇 봉째인지 (0 = 오늘 크로스). 역배열이면 null. */
  gcDays: number | null;
  /** 마지막 봉의 거래일 (ET, YYYY-MM-DD) — 스캔 실행 시각과 다를 수 있다 */
  barDate: string;
  /** Yahoo meta.regularMarketTime의 ET 날짜 — 시세 기준 마지막 거래일 */
  marketDate: string | null;
  /** 응답의 마지막 봉이 close=null이라 버려졌는지 (당일 봉 미확정 신호) */
  tailNullClose: boolean;
}

/** v20 티어 득표 수 (0~3). null 지표는 미충족으로 센다 (python fillna(False)). */
function tierVotes(r: ScanResult): number {
  return (
    Number(r.belowDays != null && r.belowDays >= TIER_MIN_BELOW_DAYS) +
    Number(r.atrRank252 != null && r.atrRank252 >= TIER_MIN_ATR_RANK) +
    Number(r.vexp63 != null && r.vexp63 >= TIER_MIN_VEXP)
  );
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
  /** 봉 시작 시각 (unix seconds, Yahoo timestamp) */
  time: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FetchedBars {
  bars: DailyBar[];
  /** meta.regularMarketTime의 ET 날짜. 없으면 null */
  marketDate: string | null;
  /** 원본 마지막 봉의 close가 null이었는지 */
  tailNullClose: boolean;
}

/**
 * Fetch close prices and volume from Yahoo Finance v8 chart API.
 * Returns null if the symbol has insufficient data or doesn't exist.
 */
async function fetchBars(symbol: string): Promise<FetchedBars | null> {
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
        meta?: { regularMarketTime?: number };
        timestamp?: number[];
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
  const rawTimes: number[] = result.timestamp ?? [];
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
      time: rawTimes[i] ?? 0,
      high: h != null && Number.isFinite(h) ? h : c,
      low: l != null && Number.isFinite(l) ? l : c,
      close: c,
      volume: v != null && Number.isFinite(v) ? v : 0,
    });
  }

  if (bars.length < MIN_BARS) return null;
  const rmt = result.meta?.regularMarketTime;
  return {
    bars,
    marketDate: rmt ? etDate(new Date(rmt * 1000)) : null,
    tailNullClose: rawCloses.length > 0 && rawCloses.at(-1) == null,
  };
}

/**
 * 이번 스캔이 다뤄야 할 세션(거래일) 날짜 — SPY의 시세 시각과 마지막 봉 중 늦은 쪽.
 * 휴장일이면 직전 거래일이 나오고, Yahoo가 SPY까지 밀려 있으면 역시 이전 날짜가
 * 나온다 (그 경우 main이 "이미 스캔함"으로 보고 다음 스케줄에 맡긴다).
 */
async function fetchSessionDate(): Promise<string> {
  const spy = await fetchBars("SPY");
  if (!spy) throw new Error("SPY bars unavailable — cannot determine session date");
  const barDate = etDate(new Date(spy.bars.at(-1)!.time * 1000));
  return spy.marketDate && spy.marketDate > barDate ? spy.marketDate : barDate;
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
  const fetched = await fetchBars(symbol);
  if (!fetched) return null;
  const { bars } = fetched;

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
    ...calcTierMetrics(bars, emaFastArr, emaSlowArr),
    gcDays: calcGcDays(sma50, sma200),
    barDate: etDate(new Date(bars.at(-1)!.time * 1000)),
    marketDate: fetched.marketDate,
    tailNullClose: fetched.tailNullClose,
  };
}

/**
 * 50/200 골든크로스 경과 봉수 — stock-quant signals/indicators.py
 * cross_days_ago(sma_50, sma_200)와 같은 정의. 0 = 오늘 크로스,
 * null = 오늘 SMA50 <= SMA200 (살아 있는 골든크로스가 없음).
 * 2y 창에서 SMA200이 시작되는 지점까지 정배열이면 실제 값의 하한이 된다.
 */
function calcGcDays(
  sma50: (number | null)[],
  sma200: (number | null)[],
): number | null {
  const above = (i: number): boolean => {
    const f = sma50[i];
    const s = sma200[i];
    return f != null && s != null && f > s;
  };
  const last = sma50.length - 1;
  if (!above(last)) return null;
  let days = 0;
  for (let i = last - 1; i >= 0 && above(i); i--) days++;
  return days;
}

/**
 * v20 티어 3표 재료 — stock-quant scripts/g1_tier_study.py의 정의를 이식.
 *   belowDays  : 어제까지 EMA9<EMA21이 연속된 봉수 (below_before)
 *   atrRank252 : 오늘 ATR%의 최근 252봉 백분위, pandas rolling.rank(pct=True)
 *                (동순위는 평균 순위) 와 동일
 *   vexp63     : 50일 평균 거래대금 / 63봉 전 같은 값
 */
function calcTierMetrics(
  bars: DailyBar[],
  ema9Arr: (number | null)[],
  ema21Arr: (number | null)[],
): Pick<ScanResult, "belowDays" | "atrRank252" | "vexp63"> {
  const n = bars.length;
  if (n < TIER_MIN_BARS) {
    return { belowDays: null, atrRank252: null, vexp63: null };
  }

  // below_before: 오늘(n-1)을 빼고 어제부터 거슬러 세는 역배열 연속 봉수
  let belowDays = 0;
  for (let i = n - 2; i >= 0; i--) {
    const f = ema9Arr[i];
    const sl = ema21Arr[i];
    if (f == null || sl == null || !(f < sl)) break;
    belowDays++;
  }

  // ATR% 시계열 → 최근 252봉 안에서 오늘 값의 백분위
  const atrPctSeries = calcAtrPctSeries(bars, ATR_PERIOD);
  const win = atrPctSeries.slice(n - G1_WINDOW);
  const today = win.at(-1)!;
  let less = 0;
  let equal = 0;
  for (const v of win) {
    if (v < today) less++;
    else if (v === today) equal++;
  }
  const atrRank252 = ((less + (equal + 1) / 2) / win.length) * 100;

  // vexp63: dollarVol50(today) / dollarVol50(63봉 전)
  const dv50 = (endExclusive: number): number => {
    const seg = bars.slice(endExclusive - 50, endExclusive);
    return seg.reduce((a, b) => a + b.close * b.volume, 0) / seg.length;
  };
  const past = dv50(n - 63);
  const vexp63 = past > 0 ? dv50(n) / past : null;

  return { belowDays, atrRank252, vexp63 };
}

/** 봉마다 ATR(period)/close*100. 앞 period 봉은 NaN (python rolling과 동일). */
function calcAtrPctSeries(bars: DailyBar[], period: number): number[] {
  const n = bars.length;
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    tr[i] = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  const out = new Array<number>(n).fill(NaN);
  let sum = 0;
  for (let i = 1; i < n; i++) {
    sum += tr[i];
    if (i > period) sum -= tr[i - period];
    if (i >= period) {
      const c = bars[i].close;
      out[i] = c > 0 ? (sum / period / c) * 100 : NaN;
    }
  }
  return out;
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
  // 0. 세션 날짜 확인 — 이미 스캔한 세션이면 건너뛴다 (예비 cron의 중복 실행,
  //    휴장일, Yahoo가 아직 새 봉을 안 준 경우). 수동 실행은 FORCE_SCAN=1로 강제.
  let sessionDate = await fetchSessionDate();
  console.log(`Session date (ET): ${sessionDate}`);
  if (!process.env.TEST_SYMBOLS && !process.env.FORCE_SCAN) {
    const prev = readPrevScanDate();
    if (prev != null && prev >= sessionDate) {
      console.log(
        `Session ${sessionDate} already scanned (g1.json scanDateET=${prev}) — ` +
          "no newer bar from Yahoo yet, or market holiday. Skipping.",
      );
      return;
    }
  }

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
  const first = await runBatch(symbols, (done, total) => {
    // Log every 250 symbols to avoid noise
    if (done - lastLog >= 250 || done === total) {
      console.log(`  Progress: ${done}/${total}`);
      lastLog = done;
    }
  });
  let results = first.results;
  const errors = first.errors;

  // 2b. 세션 날짜보다 오래된 마지막 봉 = Yahoo가 아직 당일 봉을 안 붙인 종목.
  //     잠시 뒤 다시 받아 본다. 한 종목이라도 새 봉이 있으면 세션 날짜를 올린다.
  const latestBar = (rs: ScanResult[]) =>
    rs.reduce((m, r) => (r.barDate > m ? r.barDate : m), sessionDate);
  sessionDate = latestBar(results);
  for (let round = 1; round <= STALE_RETRY_ROUNDS; round++) {
    const lagging = results.filter((r) => r.barDate < sessionDate);
    if (lagging.length === 0) break;
    console.log(
      `Stale bars: ${lagging.length} symbols behind ${sessionDate} — ` +
        `retry ${round}/${STALE_RETRY_ROUNDS} in ${STALE_RETRY_WAIT_MS / 1000}s`,
    );
    await sleep(STALE_RETRY_WAIT_MS);
    const retry = await runBatch(lagging.map((r) => r.symbol));
    const bySymbol = new Map(retry.results.map((r) => [r.symbol, r]));
    results = results.map((r) => bySymbol.get(r.symbol) ?? r);
    sessionDate = latestBar(results);
  }
  logBarDates(results);

  // 끝까지 밀린 종목은 신호에서 뺀다 — 전날 봉의 크로스를 오늘 신호로 쓰면
  // 앱의 "다음 날 시가 진입"이 이미 지난 날짜가 된다. 많이 밀렸으면 아예
  // 쓰지 않고 실패시켜서 다음 스케줄(예비 cron)이 다시 돌게 한다.
  const stale = results.filter((r) => r.barDate < sessionDate);
  const staleRatio = results.length > 0 ? stale.length / results.length : 0;
  if (stale.length > 0) {
    console.warn(
      `Excluding ${stale.length} stale symbols (${(staleRatio * 100).toFixed(1)}%): ` +
        stale.slice(0, 30).map((r) => `${r.symbol}@${r.barDate}`).join(", ") +
        (stale.length > 30 ? ", ..." : ""),
    );
  }
  if (!process.env.TEST_SYMBOLS && staleRatio > STALE_MAX_RATIO) {
    console.error(
      `Stale ratio ${(staleRatio * 100).toFixed(1)}% > ${STALE_MAX_RATIO * 100}% — ` +
        "Yahoo has not published this session's bars yet. Not writing alerts.",
    );
    process.exit(1);
  }
  const fresh = results.filter((r) => r.barDate === sessionDate);

  // 3. Filter to crossover symbols only, sort by daysOutside asc (최신 크로스오버 먼저)
  const crossed = fresh
    .filter(isCrossover)
    .filter((r) => r.close >= MIN_PRICE)
    .sort((a, b) => a.daysOutside - b.daysOutside);

  // 3b. EMA 9/21 골든크로스, 거래량 큰 순으로 정렬
  const ema921 = fresh
    .filter(isEma921Signal)
    .sort((a, b) => b.avgVolume10 - a.avgVolume10);

  // 3c. G1 — 시총 상위 2000 안에서만 (symbols는 시총 내림차순).
  //     ATR 내림차순 정렬: 포트폴리오 시뮬의 슬롯 경합 우선순위와 동일.
  const rank = new Map(symbols.map((s, i) => [s, i]));
  const g1 = fresh
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
          `cross=${r.ema921Cross} | below=${r.belowDays} atrRank=${r.atrRank252?.toFixed(1)} ` +
          `vexp=${r.vexp63?.toFixed(2)} votes=${tierVotes(r)} gc=${r.gcDays} bar=${r.barDate}`,
      );
    }
  }

  console.log(
    `Scan complete — total: ${symbols.length}, ` +
      `g1: ${g1.length}, crossovers: ${crossed.length}, ` +
      `ema9/21: ${ema921.length}, errors: ${errors.length}`
  );
  if (g1.length > 0) {
    console.log(
      "G1 symbols:",
      g1.map((r) => `${r.symbol}(${tierVotes(r)}표)`).join(", ")
    );
  }

  if (crossed.length > 0) {
    console.log("Crossover symbols:", crossed.map((r) => r.symbol).join(", "));
  }
  if (ema921.length > 0) {
    console.log("EMA 9/21 symbols:", ema921.map((r) => r.symbol).join(", "));
  }

  // 4. Write JSON for app consumption (data/alerts/*.json).
  //    TEST_SYMBOLS 모드에서는 쓰지 않는다 — 부분 스캔 결과가 실제 피드를
  //    덮어쓰면 앱이 그날의 시그널을 잃는다.
  if (process.env.TEST_SYMBOLS) {
    console.log("TEST_SYMBOLS mode — skipping alert JSON writes.");
  } else {
    writeG1Json(g1, symbols.length, sessionDate);
    writeG1History(g1);
    writeAlertsJson(crossed, symbols.length, sessionDate);
    writeEma921Json(ema921, symbols.length, sessionDate);
  }

  console.log("Done.");
}

/** 미국 동부 기준 날짜 (YYYY-MM-DD) */
function etDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 직전 스캔이 기록한 세션 날짜 (g1.json scanDateET). 파일이 없거나 읽을 수 없으면 null */
function readPrevScanDate(): string | null {
  const p = resolve(process.cwd(), "..", "data", "alerts", "g1.json");
  if (!existsSync(p)) return null;
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as { scanDateET?: string }).scanDateET ?? null;
  } catch {
    return null;
  }
}

/**
 * 마지막 봉 날짜 분포 — Yahoo 지연이 생겼을 때 봉이 빠졌는지(날짜가 밀림),
 * close=null로 왔는지(tail null), 시세는 갱신됐는데 봉만 없는지를 구분하는 근거.
 */
function logBarDates(results: ScanResult[]): void {
  const dist = new Map<string, number>();
  for (const r of results) dist.set(r.barDate, (dist.get(r.barDate) ?? 0) + 1);
  const top = [...dist]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 5)
    .map(([d, n]) => `${d}=${n}`)
    .join(", ");
  const tailNull = results.filter((r) => r.tailNullClose).length;
  const quoteAhead = results.filter((r) => r.marketDate != null && r.marketDate > r.barDate).length;
  console.log(
    `Bar dates: ${top} | tail close=null: ${tailNull} | quote newer than bar: ${quoteAhead}`,
  );
}

/** data/alerts/<filename> 에 payload 기록 (scanner.ts 기준 ../data/alerts) */
function writeAlertFile(filename: string, payload: unknown, count: number): void {
  const outDir = resolve(process.cwd(), "..", "data", "alerts");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, filename);
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${count} alerts)`);
}

/** 소수 digits자리에서 내림. 1e-9는 1.15*100 = 114.999…의 부동소수 오차 보정. */
function floorTo(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.floor(x * k + 1e-9) / k;
}

/** g1.json 한 줄 — 앱 lib/alerts.ts의 AlertItem과 같은 모양 */
function g1Item(r: ScanResult) {
  return {
    symbol: r.symbol,
    close: Number(r.close.toFixed(4)),
    ema9: Number(r.emaFast.toFixed(4)),
    ema21: Number(r.emaSlow.toFixed(4)),
    atrPct: Number(r.atrPct.toFixed(2)),
    declinePct: Number((r.declinePct ?? 0).toFixed(1)),
    baseDays: r.baseDays ?? 0,
    extPct: Number((r.extPct ?? 0).toFixed(2)),
    // v20 티어 3표 — null은 봉 부족(판정불가)
    belowDays: r.belowDays,
    // 반올림하면 1.146 → "1.15"처럼 미달 값이 임계값 이상으로 보여 표와 어긋난다.
    // 내림으로 자르면 표시값 >= 임계값 ⇔ 실제 득표가 성립한다.
    atrRank252: r.atrRank252 == null ? null : floorTo(r.atrRank252, 1),
    vexp63: r.vexp63 == null ? null : floorTo(r.vexp63, 2),
    votes: tierVotes(r),
    gcDays: r.gcDays,
  };
}

function writeG1Json(signals: ScanResult[], total: number, sessionDate: string): void {
  const slim = signals.map(g1Item);

  writeAlertFile(
    "g1.json",
    {
      scannedAt: new Date().toISOString(),
      scanDateET: sessionDate,
      total,
      count: slim.length,
      alerts: slim,
    },
    slim.length
  );
}

interface G1HistoryEntry extends ReturnType<typeof g1Item> {
  /** 신호가 난 봉의 거래일 (ET). 앱은 이 다음 봉 시가를 진입가로 본다. */
  signalDate: string;
}

/**
 * 오늘 G1 신호를 g1_history.json에 누적한다.
 *
 * 키는 (symbol, signalDate). 같은 날 재실행이 같은 신호를 다시 찾으면 값만
 * 갱신하고, 못 찾더라도 기존 기록은 지우지 않는다 — 한 번 앱에 떴던 신호는
 * 사용자가 이미 봤을 수 있어서 히스토리에서 사라지면 안 된다.
 */
function writeG1History(signals: ScanResult[]): void {
  const outPath = resolve(process.cwd(), "..", "data", "alerts", "g1_history.json");
  let entries: G1HistoryEntry[] = [];
  if (existsSync(outPath)) {
    const prev = JSON.parse(readFileSync(outPath, "utf8")) as { entries?: G1HistoryEntry[] };
    entries = prev.entries ?? [];
  }

  const key = (e: { symbol: string; signalDate: string }) => `${e.symbol}|${e.signalDate}`;
  const byKey = new Map(entries.map((e) => [key(e), e]));
  for (const r of signals) {
    const e: G1HistoryEntry = { ...g1Item(r), signalDate: r.barDate };
    byKey.set(key(e), { ...byKey.get(key(e)), ...e });
  }

  const cutoff = etDate(new Date(Date.now() - G1_HISTORY_KEEP_DAYS * 86_400_000));
  const kept = [...byKey.values()]
    .filter((e) => e.signalDate >= cutoff)
    .sort((a, b) => b.signalDate.localeCompare(a.signalDate) || b.votes - a.votes);

  writeAlertFile(
    "g1_history.json",
    { updatedAt: new Date().toISOString(), keepDays: G1_HISTORY_KEEP_DAYS, entries: kept },
    kept.length,
  );
}

function writeAlertsJson(crossed: ScanResult[], total: number, sessionDate: string): void {
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
      scanDateET: sessionDate,
      total,
      count: slim.length,
      alerts: slim,
    },
    slim.length
  );
}

function writeEma921Json(crossed: ScanResult[], total: number, sessionDate: string): void {
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
      scanDateET: sessionDate,
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
