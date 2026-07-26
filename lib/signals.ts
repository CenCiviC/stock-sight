/**
 * Trade signal feed — produced by stock-quant's spec evaluator.
 *
 * The rules are NOT reimplemented here on purpose. The screener and the
 * backtest in stock-quant share one evaluator, which is what makes a signal
 * mean the same thing in both. A second implementation in TypeScript would
 * drift from it silently. Python decides; this app displays.
 *
 * Producer: `uv run python scripts/spec_feed.py --out .../data/signals/latest.json`
 */

export type FactorState = "pass" | "fail" | "exempt" | "unknown";

export interface SignalFactor {
  id: string;
  weight: number;
  contribution: number;
  state: FactorState;
  detail: string;
}

export interface Tranche {
  id: string;
  pct: number;
  trigger: string;
}

export interface BuySignal {
  symbol: string;
  close: number;
  score: number;
  scoreMax: number;
  stopPrice: number;
  stopRef: string | null;
  stopPct: number;
  positionPct: number;
  accountRiskPct: number;
  allIn: boolean;
  tranches: Tranche[];
  atrPct: number | null;
  factors: SignalFactor[];
}

export interface SellSignal {
  symbol: string;
  close: number;
  entryPrice: number;
  gainPct: number;
  ruleId: string | null;
  reason: string;
  trails: { ref: string; level: number }[];
}

export interface WatchItem {
  symbol: string;
  close: number;
  score: number;
  scoreMax: number;
  atrPct: number | null;
  blockers: string[];
}

export interface SignalFeed {
  generatedAt: string;
  asOf: string;
  spec: { name: string; scoreMin: number; scoreMax: number };
  universe: { index: string; evaluated: number; skippedForHistory: number };
  market: {
    spyUptrend: boolean | null;
    spyGapPct: number | null;
    spyGapChange20d: number | null;
  };
  /** False means no holdings are registered, so `sell` is empty by absence of
   * data rather than by absence of signal. The UI must say so. */
  portfolioTracked: boolean;
  buy: BuySignal[];
  sell: SellSignal[];
  watch: WatchItem[];
  watchTotal: number;
}

const FEED_URL =
  "https://raw.githubusercontent.com/CenCiviC/stock-sight/main/data/signals/latest.json";

export async function fetchSignalFeed(): Promise<SignalFeed> {
  // GitHub raw caches for ~5min; the buster forces a fresh read.
  const resp = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Signal feed HTTP ${resp.status}`);
  }
  return (await resp.json()) as SignalFeed;
}

/** Korean labels for the score factor ids the spec emits. */
export const FACTOR_LABELS: Record<string, string> = {
  stock_trend_aligned: "정배열 (50>200)",
  sma200_rising: "200일선 상승",
  near_sma50: "SMA50 근처",
  near_sma200: "SMA200 근처",
  sma50_golden_cross_zone: "SMA50 골든크로스",
  low_overhead_supply: "위쪽 매물대 적음",
  support_node_nearby: "아래 매물대 가까움",
};

export const STOP_REF_LABELS: Record<string, string> = {
  ema_21: "EMA21",
  sma_50: "SMA50",
  sma_200: "SMA200",
  volume_node_below: "매물대",
};

export function factorLabel(id: string): string {
  return FACTOR_LABELS[id] ?? id;
}

export function stopRefLabel(ref: string | null): string {
  if (!ref) return "-";
  return STOP_REF_LABELS[ref] ?? ref;
}
