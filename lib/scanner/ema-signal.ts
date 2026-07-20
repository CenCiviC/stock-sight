import { rollingEMA } from "./indicators";
import type { OHLCVBar } from "./types";

/**
 * Port of "EMA 9/21 with Target Price [SS]" (Steversteves, Pine v5) signal logic.
 *
 * Pine's `ta.crossover(a, b)` is true only on the bar where `a[1] <= b[1] && a > b`.
 * The indicator's lines/labels are gated on `barstate.isconfirmed`, so signals here
 * are evaluated on closed bars only.
 */

export type EmaCrossDirection = "bullish" | "bearish";

/** 현재 봉의 가격 vs EMA 위치 (Pine의 bullish/bearish/neutral 블록) */
export type EmaSentiment = "bullish" | "bearish" | "neutral";

export interface EmaCrossSignal {
  /** Index into the original bars array */
  index: number;
  /** Bar date (YYYY-MM-DD), copied from the bar */
  date: string;
  direction: EmaCrossDirection;
  close: number;
  ema9: number;
  ema21: number;
}

export interface EmaSignalState {
  ema9: (number | null)[];
  ema21: (number | null)[];
  signals: EmaCrossSignal[];
  /** 마지막 봉의 sentiment (null이면 EMA21 시딩 전) */
  sentiment: EmaSentiment | null;
  /** 마지막 봉에서 방금 매수 신호가 떴는지 */
  isFreshBuySignal: boolean;
  /** 가장 최근 매수(골든크로스) 신호. 없으면 null */
  lastBuySignal: EmaCrossSignal | null;
  /** 마지막 매수 신호 이후 경과한 봉 수. 신호가 없으면 null */
  barsSinceBuySignal: number | null;
}

/**
 * Pine `ta.crossover(a, b)`: a[1] <= b[1] && a > b.
 * null(시딩 전)이 하나라도 끼면 교차로 보지 않는다.
 */
function isCrossover(
  a: (number | null)[],
  b: (number | null)[],
  i: number
): boolean {
  if (i < 1) return false;
  const aPrev = a[i - 1];
  const bPrev = b[i - 1];
  const aCur = a[i];
  const bCur = b[i];
  if (aPrev === null || bPrev === null || aCur === null || bCur === null) {
    return false;
  }
  return aPrev <= bPrev && aCur > bCur;
}

function sentimentAt(
  close: number,
  ema9: number,
  ema21: number
): EmaSentiment {
  // Pine: bullish = close >= ema9 and close >= ema21
  //       bearish = close <= ema9 and close <= ema21
  //       그 외는 neutral (원본의 neutral 정의는 두 조건 사이의 나머지 영역)
  if (close >= ema9 && close >= ema21) return "bullish";
  if (close <= ema9 && close <= ema21) return "bearish";
  return "neutral";
}

/**
 * 9/21 EMA 크로스 신호를 계산한다.
 *
 * 매수 신호(= Pine의 초록 삼각형 / "Bullish Cross" alert)는
 * EMA9이 EMA21을 아래에서 위로 뚫는 봉에서 정확히 한 번 발생한다.
 */
export function detectEmaCrossSignals(bars: OHLCVBar[]): EmaSignalState {
  const closes = bars.map((b) => b.close);
  const ema9 = rollingEMA(closes, 9);
  const ema21 = rollingEMA(closes, 21);

  const signals: EmaCrossSignal[] = [];

  for (let i = 1; i < bars.length; i++) {
    const crossover = isCrossover(ema9, ema21, i);
    const crossunder = isCrossover(ema21, ema9, i);
    if (!crossover && !crossunder) continue;

    signals.push({
      index: i,
      date: bars[i].date,
      direction: crossover ? "bullish" : "bearish",
      close: bars[i].close,
      ema9: ema9[i] as number,
      ema21: ema21[i] as number,
    });
  }

  const last = bars.length - 1;
  const lastEma9 = last >= 0 ? ema9[last] : null;
  const lastEma21 = last >= 0 ? ema21[last] : null;

  const sentiment =
    lastEma9 !== null && lastEma21 !== null
      ? sentimentAt(bars[last].close, lastEma9, lastEma21)
      : null;

  let lastBuySignal: EmaCrossSignal | null = null;
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].direction === "bullish") {
      lastBuySignal = signals[i];
      break;
    }
  }

  return {
    ema9,
    ema21,
    signals,
    sentiment,
    isFreshBuySignal: lastBuySignal !== null && lastBuySignal.index === last,
    lastBuySignal,
    barsSinceBuySignal:
      lastBuySignal !== null ? last - lastBuySignal.index : null,
  };
}
