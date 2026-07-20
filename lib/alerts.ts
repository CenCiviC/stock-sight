/**
 * Alert feed — fetched from public GitHub raw URL.
 * CI(scanner.ts) writes data/alerts/latest.json on each scheduled scan.
 */

export interface AlertItem {
  symbol: string;
  close: number;
  ema9: number;
  sma50: number;
  sma200: number;
  ratio: number;
  daysOutside: number;
}

export interface AlertFeed {
  scannedAt: string | null;
  scanDateET: string | null;
  total: number;
  count: number;
  alerts: AlertItem[];
}

/** EMA 9/21 골든크로스 종목 (TradingView ta.crossover(ema9, ema21) 포팅) */
export interface Ema921Item {
  symbol: string;
  close: number;
  ema9: number;
  ema21: number;
  /** (EMA9 - EMA21) / EMA21 * 100 — 크로스 직후라 보통 0에 가깝다 */
  gapPct: number;
  /** 전일 종가 대비 변화율 (%) */
  changePct: number;
  avgVolume10: number;
}

export interface Ema921Feed {
  scannedAt: string | null;
  scanDateET: string | null;
  total: number;
  count: number;
  alerts: Ema921Item[];
}

const RAW_BASE =
  "https://raw.githubusercontent.com/CenCiviC/stock-sight/main/data/alerts";

const FEED_URL = `${RAW_BASE}/latest.json`;
const EMA921_FEED_URL = `${RAW_BASE}/ema921.json`;

async function fetchFeed<T>(url: string, label: string): Promise<T> {
  // cache buster: GitHub raw caches ~5min; appending ?t= forces fresh fetch
  const resp = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`${label} HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function fetchAlertFeed(): Promise<AlertFeed> {
  return fetchFeed<AlertFeed>(FEED_URL, "Alert feed");
}

export async function fetchEma921Feed(): Promise<Ema921Feed> {
  return fetchFeed<Ema921Feed>(EMA921_FEED_URL, "EMA 9/21 feed");
}
