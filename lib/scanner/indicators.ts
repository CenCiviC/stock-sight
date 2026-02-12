import type { OHLCVBar } from "./types";

/**
 * Calculate trailing return over a given number of days.
 * Equivalent to: series[-1] / series[-days-1] - 1.0
 */
export function trailingReturn(closes: number[], days: number): number {
  if (closes.length <= days) {
    return NaN;
  }
  const current = closes[closes.length - 1];
  const past = closes[closes.length - days - 1];
  if (past === 0 || !isFinite(current) || !isFinite(past)) {
    return NaN;
  }
  const result = current / past - 1.0;
  return isFinite(result) ? result : NaN;
}

/**
 * Rolling Simple Moving Average.
 * Returns null for positions where there is insufficient data (< period values).
 * Equivalent to pandas Series.rolling(window=period).mean()
 */
export function rollingSMA(
  values: number[],
  period: number
): (number | null)[] {
  const result: (number | null)[] = new Array(values.length);

  if (period <= 0 || values.length === 0) {
    result.fill(null);
    return result;
  }

  // Build initial window sum
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sum += values[i];
      result[i] = null;
    } else if (i === period - 1) {
      sum += values[i];
      result[i] = sum / period;
    } else {
      sum += values[i] - values[i - period];
      result[i] = sum / period;
    }
  }

  return result;
}

/**
 * Rolling Standard Deviation (population=false, ddof=1 to match pandas default).
 * Returns null for positions where there is insufficient data (< period values).
 * Equivalent to pandas Series.rolling(window=period).std()
 */
export function rollingStd(
  values: number[],
  period: number
): (number | null)[] {
  const result: (number | null)[] = new Array(values.length);

  if (period <= 1 || values.length === 0) {
    result.fill(null);
    return result;
  }

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result[i] = null;
    } else {
      // Compute mean and variance for the window [i - period + 1 .. i]
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += values[j];
      }
      const mean = sum / period;

      let sumSqDiff = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = values[j] - mean;
        sumSqDiff += diff * diff;
      }
      // ddof=1 (Bessel's correction) to match pandas default
      result[i] = Math.sqrt(sumSqDiff / (period - 1));
    }
  }

  return result;
}

/**
 * Rolling Maximum over a window of `period` values.
 * Returns null for positions where there is insufficient data (< period values).
 * Equivalent to pandas Series.rolling(window=period).max()
 */
export function rollingMax(
  values: number[],
  period: number
): (number | null)[] {
  const result: (number | null)[] = new Array(values.length);

  if (period <= 0 || values.length === 0) {
    result.fill(null);
    return result;
  }

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result[i] = null;
    } else {
      let max = -Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (values[j] > max) {
          max = values[j];
        }
      }
      result[i] = max;
    }
  }

  return result;
}

/**
 * Calculate Average True Range (ATR).
 * Port of indicators.py calculate_atr.
 *
 * True Range = max(high - low, |high - prev_close|, |low - prev_close|)
 * ATR = rolling mean of True Range over `period` bars.
 *
 * Returns null for the first (period) elements where there is insufficient data.
 */
export function calculateATR(
  bars: OHLCVBar[],
  period: number = 20
): (number | null)[] {
  if (bars.length === 0) {
    return [];
  }

  // Compute True Range for each bar
  const tr: number[] = new Array(bars.length);
  tr[0] = bars[0].high - bars[0].low; // No previous close for first bar

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);

    tr[i] = Math.max(tr1, tr2, tr3);
  }

  // ATR is the rolling mean of TR
  // First element has no prev close shift, matching pandas behavior where
  // close.shift(1) at index 0 is NaN, making tr2/tr3 NaN, so TR[0] is NaN.
  // We set tr[0] to NaN to match pandas exactly.
  const trWithNaN: number[] = [...tr];
  trWithNaN[0] = NaN;

  return rollingSMA(trWithNaN, period);
}
