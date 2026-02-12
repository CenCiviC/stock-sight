import type { IndexType, Stock } from "@/lib/scanner";

/** Scan metadata (no stocks array) */
export interface ScanSummary {
  id: number;
  index_type: IndexType;
  count: number;
  scanned_at: string;
  created_at: string;
}

/** Full scan record with stocks */
export interface ScanRecord extends ScanSummary {
  stocks: Stock[];
}

/** Comparison between two scans */
export interface ComparisonResult {
  common: ComparisonStock[];
  new_entries: Stock[];
  dropped: Stock[];
}

/** Stock present in both scans with delta */
export interface ComparisonStock {
  symbol: string;
  current: Stock;
  previous: Stock;
  rs_delta: number;
}
