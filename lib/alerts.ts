/**
 * Alert feeds — fetched from public GitHub raw URL.
 * CI(scanner.ts) writes data/alerts/*.json on each scheduled scan.
 */

import type { OHLCVBar } from "@/lib/scanner";

/**
 * G1 매수 시그널 — stock-quant에서 10년 검증된 폭발주 룰 (Today 탭).
 * EMA9/21 골든크로스 + ATR%≥6 + 하락이력≥30% + 바닥 63일↑ + 이격≤5%,
 * 시총 상위 2000 · $5↑ · 거래대금 $10M/일↑ · 중국 ADR 제외.
 */
export interface AlertItem {
  symbol: string;
  close: number;
  ema9: number;
  ema21: number;
  /** ATR(20)/종가*100 — 시그널 자격이자 슬롯 우선순위 */
  atrPct: number;
  /** 252일 고점 → 이후 저점 드로다운 % (ㄴ자의 세로획) */
  declinePct: number;
  /** 252일 저점 이후 경과 봉수 (바닥 다진 기간) */
  baseDays: number;
  /** (close/EMA21 - 1) * 100 — 크로스 시점 과확장 정도 */
  extPct: number;

  // --- v20 티어 3표 (stock-quant explosive_hunt_v1.md v20) ---
  // 진입 조건이 아니라 비중 근거. 구버전 피드에는 없어 optional, null은 봉 부족.
  /** 크로스 직전 EMA9<EMA21 연속 봉수. 14 이상이면 1표 */
  belowDays?: number | null;
  /** 오늘 ATR%의 최근 252봉 백분위(0~100). 60 이상이면 1표 */
  atrRank252?: number | null;
  /** 50일 평균 거래대금 / 63봉 전. 1.15 이상이면 1표 */
  vexp63?: number | null;
  /** 위 세 표의 합 (0~3) */
  votes?: number;
  /** SMA50이 SMA200 위로 올라선 지 몇 봉째인지. null = 역배열. 구버전 피드에는 없음. */
  gcDays?: number | null;
}

/** v20 티어 임계값 — 스캐너(scanner/scanner.ts)와 같은 값 */
export const TIER_MIN_BELOW_DAYS = 14;
export const TIER_MIN_ATR_RANK = 60;
export const TIER_MIN_VEXP = 1.15;

/**
 * G1 비중 등급 — 3표 × 50/200 골든크로스 경과일로 나눈 참고 분류.
 * stock-quant G1 신호 528건(2018~2026.4) 사후 분석에서 나온 가설이라
 * 검증된 규칙이 아니다. 확대(2~3표 & GC 21~120일): 폭발 48%·승률 70%,
 * 축소(GC 0~20일, 또는 0~1표 & GC 61일+): 대패가 많거나 중앙값이 약함.
 */
export type G1Grade = "확대" | "기본" | "축소";

export function g1Grade(votes: number, gcDays: number | null): G1Grade {
  if (gcDays == null) return "기본";
  if (votes >= 2 && gcDays >= 21 && gcDays <= 120) return "확대";
  if (gcDays <= 20 || (votes <= 1 && gcDays > 60)) return "축소";
  return "기본";
}

/** G1 보유 기간 — 신호 다음 날 시가 진입, 63거래일째 종가 청산 */
export const G1_HOLD_DAYS = 63;

export interface G1Progress {
  /** 신호 다음 봉 시가. 아직 다음 봉이 없으면 null */
  entryPrice: number | null;
  /** 진입 후 경과 거래일 (진입일 = 1) */
  day: number;
  /** 진입가 대비 수익률 %. 63일이 지났으면 63일째 종가 기준 */
  returnPct: number | null;
  /** 63거래일 보유 완료 */
  expired: boolean;
}

/** 일봉으로 G1 보유 진행 상황을 계산한다 (신호 다음 날 시가 진입, 63거래일 보유). */
export function g1Progress(signalDate: string, bars: OHLCVBar[]): G1Progress {
  const after = bars.filter((b) => b.date > signalDate);
  if (after.length === 0) {
    return { entryPrice: null, day: 0, returnPct: null, expired: false };
  }
  const entryPrice = after[0].open;
  const expired = after.length >= G1_HOLD_DAYS;
  const exitBar = expired ? after[G1_HOLD_DAYS - 1] : after[after.length - 1];
  return {
    entryPrice,
    day: Math.min(after.length, G1_HOLD_DAYS),
    returnPct: entryPrice > 0 ? (exitBar.close / entryPrice - 1) * 100 : null,
    expired,
  };
}

/** g1_history.json 한 줄 — 신호 당일 g1.json 항목 + 신호 봉 날짜 */
export interface G1HistoryEntry extends AlertItem {
  /** 신호가 난 봉의 거래일 (ET, YYYY-MM-DD) */
  signalDate: string;
  votes: number;
  gcDays: number | null;
  /** git 기록에서 복원한 항목 (표 값은 사후 재계산) */
  backfilled?: boolean;
}

export interface G1HistoryFeed {
  updatedAt: string;
  keepDays: number;
  entries: G1HistoryEntry[];
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
  /** ATR(20)/종가*100. 구버전 피드에는 없어 optional. */
  atrPct?: number;
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

const FEED_URL = `${RAW_BASE}/g1.json`;
const EMA921_FEED_URL = `${RAW_BASE}/ema921.json`;
const G1_HISTORY_URL = `${RAW_BASE}/g1_history.json`;

async function fetchFeed<T>(url: string, label: string): Promise<T> {
  // cache buster: GitHub raw caches ~5min; appending ?t= forces fresh fetch
  const resp = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`${label} HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function fetchAlertFeed(): Promise<AlertFeed> {
  return fetchFeed<AlertFeed>(FEED_URL, "G1 feed");
}

export async function fetchEma921Feed(): Promise<Ema921Feed> {
  return fetchFeed<Ema921Feed>(EMA921_FEED_URL, "EMA 9/21 feed");
}

export async function fetchG1History(): Promise<G1HistoryFeed> {
  return fetchFeed<G1HistoryFeed>(G1_HISTORY_URL, "G1 history");
}
