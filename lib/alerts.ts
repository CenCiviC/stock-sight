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
 * G1 매수 등급 — Today 탭은 확장·확대 신호만 보여주고 나머지 G1은 숨긴다.
 * 근거: stock-quant 상폐 포함 PIT(Sharadar) 512건, 2016-07~2026-07, 63일 결과.
 *   확장: (거래대금 ×1.15↑ 또는 ATR 8%↑) ∧ SMA50/200 GC 120일 이하 또는 역배열
 *         141건 · hit50(63일 내 +50%) 37% · 평균 r63 +14%
 *   확대: 3표 중 2표↑ ∧ GC 21~120일 — 62건 · hit50 35.5%. 55건이 확장과 겹친다.
 *   그 외 G1: 364건 · hit50 17% · 평균 r63 +6% (숨김)
 */
export const EXT_MIN_ATR = 8;
export const EXT_MIN_VEXP = 1.15;
export const EXT_MAX_GC = 120;
export const HWAK_MIN_GC = 21;
export const HWAK_MAX_GC = 120;

type TierFields = Pick<AlertItem, "atrPct" | "vexp63" | "gcDays" | "votes">;

/** 확장 — 수급(거래대금 증가) 또는 고변동성, 그리고 장기 추세가 너무 늦지 않음 */
export function isExt(e: TierFields): boolean {
  const gcOk = e.gcDays == null || e.gcDays <= EXT_MAX_GC;
  const vexpOk = e.vexp63 != null && e.vexp63 >= EXT_MIN_VEXP;
  return gcOk && (vexpOk || e.atrPct >= EXT_MIN_ATR);
}

/** 확대 — 3표 중 2표 이상 ∧ GC 21~120일 */
export function isHwak(e: TierFields): boolean {
  return (
    (e.votes ?? 0) >= 2 &&
    e.gcDays != null &&
    e.gcDays >= HWAK_MIN_GC &&
    e.gcDays <= HWAK_MAX_GC
  );
}

/** Today 탭에 보여줄 신호인가 (확장 또는 확대) */
export function isShownG1(e: TierFields): boolean {
  return isExt(e) || isHwak(e);
}

/** 정렬 순위 — 둘 다 0, 확장만 1, 확대만 2, 나머지 3 */
export function tierRank(e: TierFields): number {
  const x = isExt(e);
  const h = isHwak(e);
  return x && h ? 0 : x ? 1 : h ? 2 : 3;
}

/** G1 보유 기간 — 신호 다음 날 시가 진입, 63거래일째 종가 청산 */
export const G1_HOLD_DAYS = 63;

/** 매매 규칙 — 장중 −15% 손절, 21거래일째 종가가 진입가 아래면 다음 날 시가 정리, +50% 익절 */
export const G1_STOP_PCT = 15;
export const G1_TIME_STOP_DAY = 21;
export const G1_TAKE_PROFIT_PCT = 50;

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

export type G1ExitState = "wait" | "live" | "stop" | "time" | "tp" | "expired";

export interface G1Exit {
  /** 신호 다음 봉 시가. 아직 다음 봉이 없으면 null */
  entryPrice: number | null;
  /** live: 경과 거래일, 청산됨: 청산한 거래일 (진입일 = 1) */
  day: number;
  /** 진입가 대비 수익률 %. live는 최근 종가, 청산됨은 청산가 기준 */
  returnPct: number | null;
  state: G1ExitState;
  /** 시간손절이 확정됐지만 다음 날 시가가 아직 없음 */
  pending: boolean;
}

/**
 * 매매 규칙대로 들고 있었다면 지금 어떤지 (stock-quant stop_scan.py와 같은 순서).
 * 매 봉: ① 전날 시간손절 확정이면 시가 청산 ② 저가 ≤ −15%면 손절(갭이면 시가)
 * ③ 고가 ≥ +50%면 익절(갭이면 시가) ④ 21번째 봉 종가 < 진입가면 다음 날 시가 정리
 * ⑤ 63번째 봉 종가 만기. 같은 봉에서 손절과 익절이 겹치면 손절이 먼저다.
 */
export function g1Exit(signalDate: string, bars: OHLCVBar[]): G1Exit {
  const after = bars.filter((b) => b.date > signalDate);
  if (after.length === 0 || !(after[0].open > 0)) {
    return { entryPrice: null, day: 0, returnPct: null, state: "wait", pending: false };
  }
  const entry = after[0].open;
  const stop = entry * (1 - G1_STOP_PCT / 100);
  const tp = entry * (1 + G1_TAKE_PROFIT_PCT / 100);
  const ret = (px: number) => (px / entry - 1) * 100;
  const done = (state: G1ExitState, i: number, px: number): G1Exit => ({
    entryPrice: entry,
    day: i + 1,
    returnPct: ret(px),
    state,
    pending: false,
  });
  let timeExit = false;
  for (let i = 0; i < Math.min(after.length, G1_HOLD_DAYS); i++) {
    const b = after[i];
    if (timeExit) return done("time", i, b.open);
    if (b.low <= stop) return done("stop", i, Math.min(b.open, stop));
    if (b.high >= tp) return done("tp", i, Math.max(b.open, tp));
    if (i === G1_HOLD_DAYS - 1) return done("expired", i, b.close);
    if (i === G1_TIME_STOP_DAY - 1 && b.close < entry) timeExit = true;
  }
  const n = Math.min(after.length, G1_HOLD_DAYS);
  const last = after[n - 1];
  return {
    entryPrice: entry,
    day: n,
    returnPct: ret(last.close),
    state: timeExit ? "time" : "live",
    pending: timeExit,
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
