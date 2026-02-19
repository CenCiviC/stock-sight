import type { OHLCVBar, SymbolData } from "./types";
import {
  trailingReturn,
  rollingSMA,
  rollingStd,
  rollingMax,
  calculateATR,
} from "./indicators";

interface SpyReturns {
  r_12m: number;
  r_6m: number;
  r_3m: number;
  r_1m: number;
}

/**
 * Compute all VCP data and conditions for a single symbol.
 * Port of vcp.py _compute_symbol_data.
 *
 * @returns SymbolData if computation succeeds, null if insufficient data.
 */
export function computeSymbolData(
  bars: OHLCVBar[],
  spyReturns: SpyReturns,
  currentPrice: number
): SymbolData | null {
  if (bars.length < 50) {
    return null;
  }

  const closes = bars.map((b) => b.close);

  // Fallback: if currentPrice is invalid, use last bar's close
  if (!isFinite(currentPrice) || currentPrice <= 0) {
    currentPrice = closes[closes.length - 1];
  }

  if (!isFinite(currentPrice) || currentPrice < 5) {
    return null;
  }

  // Filter: 50-day average volume must be >= 1M
  const recent50 = bars.slice(-50);
  const avgVolume50d =
    recent50.reduce((sum, b) => sum + b.volume, 0) / recent50.length;
  if (avgVolume50d < 1_000_000) {
    return null;
  }

  // Moving averages
  const ma50Arr = rollingSMA(closes, 50);
  const ma150Arr = rollingSMA(closes, 150);
  const ma200Arr = rollingSMA(closes, 200);

  const ma50 = ma50Arr[ma50Arr.length - 1];
  const ma150 = ma150Arr[ma150Arr.length - 1];
  const ma200 = ma200Arr[ma200Arr.length - 1];

  if (ma50 == null || ma150 == null || ma200 == null) {
    return null;
  }

  // 52-week high (252 trading days)
  const high52wArr = rollingMax(closes, 252);
  const high_52w = high52wArr[high52wArr.length - 1];
  if (high_52w == null) {
    return null;
  }

  // Returns
  const r_12m = trailingReturn(closes, 252);
  const r_6m = trailingReturn(closes, 126);
  const r_3m = trailingReturn(closes, 63);
  const r_1m = trailingReturn(closes, 21);

  // === VCP Conditions ===

  // cond_1: Price > SMA(50) > SMA(150) > SMA(200)
  const cond_price_sma_order =
    isFinite(currentPrice) &&
    isFinite(ma50) &&
    isFinite(ma150) &&
    isFinite(ma200) &&
    currentPrice > ma50 &&
    ma50 > ma150 &&
    ma150 > ma200;

  // cond_2: SMA(150) > SMA(200)
  const cond_ma150_above_ma200 =
    isFinite(ma150) && isFinite(ma200) && ma150 > ma200;

  // cond_3: SMA(200) not declining over 21 days
  let cond_ma200_not_declining = false;
  if (ma200Arr.length >= 221) {
    const ma200_21d_ago = ma200Arr[ma200Arr.length - 21];
    cond_ma200_not_declining =
      ma200_21d_ago != null &&
      isFinite(ma200) &&
      isFinite(ma200_21d_ago) &&
      ma200 >= ma200_21d_ago;
  }

  // cond_4: Price >= 70% of 52-week high
  const cond_within_52w_high_range =
    isFinite(currentPrice) &&
    isFinite(high_52w) &&
    currentPrice >= high_52w * 0.6;

  // cond_5: Outperform SPY on 3m and 6m returns
  const cond_outperform_index =
    isFinite(r_3m) &&
    isFinite(r_6m) &&
    isFinite(spyReturns.r_3m) &&
    isFinite(spyReturns.r_6m) &&
    r_3m > spyReturns.r_3m &&
    r_6m > spyReturns.r_6m;

  // cond_6: Volatility decreasing
  const cond_volatility_decreasing = checkVolatilityDecreasing(bars);

  // cond_7: Pullback within 35%
  const cond_pullback_within_range = checkPullbackWithinRange(bars);

  // cond_8: Volume decreases on pullback
  const cond_volume_decrease_on_pullback = checkVolumeDecreaseOnPullback(bars);

  // RS score
  const score =
    0.4 * (isFinite(r_12m) ? r_12m : 0) +
    0.2 * (isFinite(r_6m) ? r_6m : 0) +
    0.2 * (isFinite(r_3m) ? r_3m : 0) +
    0.2 * (isFinite(r_1m) ? r_1m : 0);

  // 5-day-ago score
  const score_5days_ago = computeScore5DaysAgo(bars);

  return {
    symbol: "", // Caller sets this
    close: currentPrice,
    ma50,
    ma150,
    ma200,
    high_52w,
    r_12m,
    r_6m,
    r_3m,
    r_1m,
    score,
    score_5days_ago,
    cond_price_sma_order,
    cond_ma150_above_ma200,
    cond_ma200_not_declining,
    cond_within_52w_high_range,
    cond_outperform_index,
    cond_volatility_decreasing,
    cond_pullback_within_range,
    cond_volume_decrease_on_pullback,
  };
}

/**
 * Check if ATR% or StdDev% is decreasing.
 * Compares recent 10-day average vs prior 10-day average (20-day window split).
 * ATR and StdDev are normalized by close price to avoid price-level distortion.
 */
export function checkVolatilityDecreasing(bars: OHLCVBar[]): boolean {
  if (bars.length < 41) {
    return false;
  }

  const closes = bars.map((b) => b.close);
  const atrArr = calculateATR(bars, 20);
  const stdArr = rollingStd(closes, 20);

  // Need at least 20 values to split into two 10-day windows
  if (atrArr.length < 20 || stdArr.length < 20) {
    return false;
  }

  // ATR% = ATR / Close, averaged over recent 10 days vs prior 10 days
  const atrRecent10 = atrArr.slice(-10);
  const atrPrior10 = atrArr.slice(-20, -10);
  const closesRecent10 = closes.slice(-10);
  const closesPrior10 = closes.slice(-20, -10);

  const avgAtrPctRecent = safeAvg(
    atrRecent10.map((v, i) => (closesRecent10[i] > 0 ? v / closesRecent10[i] : NaN))
  );
  const avgAtrPctPrior = safeAvg(
    atrPrior10.map((v, i) => (closesPrior10[i] > 0 ? v / closesPrior10[i] : NaN))
  );

  // StdDev% = StdDev / Close, averaged over recent 10 days vs prior 10 days
  const stdRecent10 = stdArr.slice(-10);
  const stdPrior10 = stdArr.slice(-20, -10);

  const avgStdPctRecent = safeAvg(
    stdRecent10.map((v, i) => (closesRecent10[i] > 0 ? v / closesRecent10[i] : NaN))
  );
  const avgStdPctPrior = safeAvg(
    stdPrior10.map((v, i) => (closesPrior10[i] > 0 ? v / closesPrior10[i] : NaN))
  );

  const atrDecreasing =
    isFinite(avgAtrPctRecent) && isFinite(avgAtrPctPrior) &&
    avgAtrPctRecent < avgAtrPctPrior;

  const stdDecreasing =
    isFinite(avgStdPctRecent) && isFinite(avgStdPctPrior) &&
    avgStdPctRecent < avgStdPctPrior;

  return atrDecreasing || stdDecreasing;
}

/** Average of finite values only. Returns NaN if no valid values. */
function safeAvg(values: number[]): number {
  const valid = values.filter(isFinite);
  if (valid.length === 0) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Check if recent pullback is within 35%.
 * Port of vcp.py _check_pullback_within_range.
 */
export function checkPullbackWithinRange(bars: OHLCVBar[]): boolean {
  if (bars.length < 40) {
    return false;
  }

  const recent40 = bars.slice(-40);

  // Recent high from High prices in last 40 bars
  let recentHigh = -Infinity;
  for (const bar of recent40) {
    if (bar.high > recentHigh) recentHigh = bar.high;
  }

  // Current low from Low prices in last 20 bars
  const recent20 = bars.slice(-20);
  let currentLow = Infinity;
  for (const bar of recent20) {
    if (bar.low < currentLow) currentLow = bar.low;
  }

  if (isFinite(recentHigh) && isFinite(currentLow) && recentHigh > 0) {
    const pullbackPct = (recentHigh - currentLow) / recentHigh;
    return pullbackPct <= 0.4;
  }

  return false;
}

/**
 * Check if volume decreases after the highest price point in the last 40 bars.
 * Port of vcp.py _check_volume_decrease_on_pullback.
 */
export function checkVolumeDecreaseOnPullback(bars: OHLCVBar[]): boolean {
  if (bars.length < 40) {
    return false;
  }

  const recent40 = bars.slice(-40);

  // Find position of highest high in recent 40 bars
  let highPosition = 0;
  let highValue = -Infinity;
  for (let i = 0; i < recent40.length; i++) {
    if (recent40[i].high > highValue) {
      highValue = recent40[i].high;
      highPosition = i;
    }
  }

  // Average volume before the high
  let volumeBefore: number;
  if (highPosition >= 10) {
    const beforeBars = recent40.slice(highPosition - 10, highPosition);
    volumeBefore =
      beforeBars.reduce((sum, b) => sum + b.volume, 0) / beforeBars.length;
  } else if (highPosition > 0) {
    const beforeBars = recent40.slice(0, highPosition);
    volumeBefore =
      beforeBars.reduce((sum, b) => sum + b.volume, 0) / beforeBars.length;
  } else {
    return false;
  }

  // Average volume of the most recent 10 days (current pullback period)
  const recent10 = recent40.slice(-10);
  const volumeAfter =
    recent10.reduce((sum, b) => sum + b.volume, 0) / recent10.length;

  return (
    isFinite(volumeBefore) &&
    isFinite(volumeAfter) &&
    volumeBefore > 0 &&
    volumeAfter < volumeBefore
  );
}

/**
 * Compute RS score as of 5 trading days ago.
 * Port of vcp.py _compute_score_5days_ago.
 */
export function computeScore5DaysAgo(bars: OHLCVBar[]): number | null {
  if (bars.length < 5) {
    return null;
  }

  const bars5dAgo = bars.slice(0, -5);
  if (bars5dAgo.length === 0) {
    return null;
  }

  const closes = bars5dAgo.map((b) => b.close);

  const r_12m = trailingReturn(closes, 252);
  const r_6m = trailingReturn(closes, 126);
  const r_3m = trailingReturn(closes, 63);
  const r_1m = trailingReturn(closes, 21);

  return (
    0.4 * (isFinite(r_12m) ? r_12m : 0) +
    0.2 * (isFinite(r_6m) ? r_6m : 0) +
    0.2 * (isFinite(r_3m) ? r_3m : 0) +
    0.2 * (isFinite(r_1m) ? r_1m : 0)
  );
}
