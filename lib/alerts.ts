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

const FEED_URL =
  "https://raw.githubusercontent.com/CenCiviC/stock-sight/main/data/alerts/latest.json";

export async function fetchAlertFeed(): Promise<AlertFeed> {
  // cache buster: GitHub raw caches ~5min; appending ?t= forces fresh fetch
  const url = `${FEED_URL}?t=${Date.now()}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Alert feed HTTP ${resp.status}`);
  }
  return (await resp.json()) as AlertFeed;
}
