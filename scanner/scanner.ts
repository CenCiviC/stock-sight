#!/usr/bin/env tsx
/**
 * US Stock Scanner — EMA9 / SMA50 Crossover Detector
 *
 * Fetches NASDAQ 5000 symbols, calculates EMA9 & SMA50,
 * and sends a Discord alert for symbols where EMA9 crosses above SMA50.
 *
 * Crossover condition:
 *   previous days (10+ consecutive): EMA9 / SMA50 < 1.0
 *   current day:                     EMA9 / SMA50 >= 0.95
 *                                    AND Close >= SMA200 * 0.95
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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

const OUTSIDE_RANGE_MIN_DAYS = 10; // 진입 전 최소 연속 범위 밖 일수

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
}

function isCrossover(r: ScanResult): boolean {
  // 1) 직전 최소 10일 연속 ratio < 1.0 (EMA9가 SMA50 아래에 있었음)
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
// Discord
// ──────────────────────────────────────────────

const DISCORD_MAX_DESC = 4096;

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v.toFixed(0)}`;
}

function resultLine(r: ScanResult): string {
  return (
    `🟢 **${r.symbol}** — ` +
    `Close: \`$${r.close.toFixed(2)}\` | ` +
    `EMA9: \`${r.ema9.toFixed(2)}\` | ` +
    `SMA50: \`${r.sma50.toFixed(2)}\` | ` +
    `SMA200: \`${r.sma200.toFixed(2)}\` | ` +
    `Ratio: \`${r.ratio.toFixed(3)}\` | ` +
    `Vol(10d): \`${formatVolume(r.avgVolume10)}\` | ` +
    `범위 밖: \`${r.daysOutside}일\``
  );
}

function buildDiscordPayload(
  crossed: ScanResult[],
  errors: string[],
  total: number
): object {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const hasHits = crossed.length > 0;

  // Build description (respect 4096 char Discord limit)
  let description: string;
  if (hasHits) {
    const lines = crossed.map(resultLine);
    const joined = lines.join("\n");
    if (joined.length <= DISCORD_MAX_DESC) {
      description = joined;
    } else {
      // Truncate with note
      let acc = "";
      let shown = 0;
      for (const line of lines) {
        if ((acc + "\n" + line).length > DISCORD_MAX_DESC - 50) break;
        acc += (acc ? "\n" : "") + line;
        shown++;
      }
      description = acc + `\n_…외 ${crossed.length - shown}개_`;
    }
  } else {
    description = "오늘은 조건을 충족하는 종목이 없습니다.";
  }

  const fields: object[] = [
    { name: "스캔 날짜 (ET)", value: date, inline: true },
    { name: "감시 종목", value: `${total}개`, inline: true },
    { name: "돌파 종목", value: `${crossed.length}개`, inline: true },
  ];

  if (errors.length > 0) {
    const errStr =
      errors.length <= 20
        ? errors.map((s) => `\`${s}\``).join(", ")
        : errors
            .slice(0, 20)
            .map((s) => `\`${s}\``)
            .join(", ") + ` 외 ${errors.length - 20}개`;
    fields.push({ name: "⚠️ 스캔 실패", value: errStr, inline: false });
  }

  return {
    embeds: [
      {
        title: hasHits
          ? `📈 EMA9 상향 돌파 — ${crossed.length}종목 감지`
          : "📭 EMA9 상향 돌파 종목 없음",
        description,
        color: hasHits ? 0xf0b429 : 0x6b7280,
        fields,
        footer: {
          text: `SMA50 95% 이상 진입 (10일+ 아래 → 위) & EMA9 상승 & 종가 ≥ SMA200×95% & 10일 평균 거래량 ≥ 500K | NASDAQ ~5000종목`,
        },
      },
    ],
  };
}

async function sendDiscord(webhookUrl: string, payload: object): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${resp.status}: ${text}`);
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const webhookUrl = (process.env["DISCORD_WEBHOOK_URL"] ?? "").trim();
  if (!webhookUrl) {
    console.error("Error: DISCORD_WEBHOOK_URL environment variable is not set");
    process.exit(1);
  }

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

  // 3. Filter to crossover symbols only, sort by daysOutside desc (가장 오랫동안 밖에 있던 것 먼저)
  const crossed = results
    .filter(isCrossover)
    .filter((r) => r.close >= MIN_PRICE)
    .sort((a, b) => b.daysOutside - a.daysOutside);

  console.log(
    `Scan complete — total: ${symbols.length}, ` +
      `crossovers: ${crossed.length}, errors: ${errors.length}`
  );

  if (crossed.length > 0) {
    console.log("Crossover symbols:", crossed.map((r) => r.symbol).join(", "));
  }

  // 4. Send Discord notification
  const payload = buildDiscordPayload(crossed, errors, symbols.length);
  console.log("Sending Discord notification...");
  await sendDiscord(webhookUrl, payload);

  // 5. Write JSON for app consumption (data/alerts/latest.json)
  writeAlertsJson(crossed, symbols.length);

  console.log("Done.");
}

function writeAlertsJson(crossed: ScanResult[], total: number): void {
  const scanDateET = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD

  const slim = crossed.map((r) => ({
    symbol: r.symbol,
    close: Number(r.close.toFixed(4)),
    ema9: Number(r.ema9.toFixed(4)),
    sma50: Number(r.sma50.toFixed(4)),
    sma200: Number(r.sma200.toFixed(4)),
    ratio: Number(r.ratio.toFixed(4)),
    daysOutside: r.daysOutside,
  }));

  const payload = {
    scannedAt: new Date().toISOString(),
    scanDateET,
    total,
    count: slim.length,
    alerts: slim,
  };

  // scanner.ts 기준 ../data/alerts/latest.json
  const outDir = resolve(process.cwd(), "..", "data", "alerts");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "latest.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${slim.length} alerts)`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
