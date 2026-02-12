import type { Stock } from "@/lib/scanner";
import type { ComparisonResult, ComparisonStock } from "./types";

/**
 * Compare two sets of scan stocks.
 * @param current  - Stocks from the newer scan
 * @param previous - Stocks from the older scan
 */
export function compareScanResults(
  current: Stock[],
  previous: Stock[]
): ComparisonResult {
  const prevMap = new Map(previous.map((s) => [s.symbol, s]));
  const currMap = new Map(current.map((s) => [s.symbol, s]));

  const common: ComparisonStock[] = [];
  const new_entries: Stock[] = [];

  for (const stock of current) {
    const prev = prevMap.get(stock.symbol);
    if (prev) {
      common.push({
        symbol: stock.symbol,
        current: stock,
        previous: prev,
        rs_delta:
          Math.round((stock.rs_percentile - prev.rs_percentile) * 100) / 100,
      });
    } else {
      new_entries.push(stock);
    }
  }

  const dropped: Stock[] = previous.filter((s) => !currMap.has(s.symbol));

  common.sort((a, b) => b.rs_delta - a.rs_delta);

  return { common, new_entries, dropped };
}
