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

/** RS ranking record from DB */
export interface RsRankingRecord {
  id: number;
  count: number;
  scanned_at: string;
  created_at: string;
  stocks: import("@/lib/scanner").RankedStock[];
}

/** Favorite stock record from DB */
export interface FavoriteRecord {
  id: number;
  symbol: string;
  close: number;
  rs_percentile: number;
  rs_change: number;
  returns: { r_12m: number; r_6m: number; r_3m: number; r_1m: number };
  failed_conditions: string[];
  source_index: string;
  favorited_at: string;
}

/** Rank change between two ranking snapshots */
export interface RankChange {
  symbol: string;
  current_rank: number;
  prev_rank: number | null;
  rank_delta: number | null;
}
