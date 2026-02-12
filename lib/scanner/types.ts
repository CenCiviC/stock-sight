export type IndexType = "nasdaq" | "russell_1000" | "sp500";

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolData {
  symbol: string;
  close: number;

  // Moving averages
  ma50: number;
  ma150: number;
  ma200: number;

  // 52-week high
  high_52w: number;

  // Returns
  r_12m: number;
  r_6m: number;
  r_3m: number;
  r_1m: number;

  // RS scores
  score: number;
  score_5days_ago: number | null;

  // VCP conditions
  cond_price_sma_order: boolean;
  cond_ma150_above_ma200: boolean;
  cond_ma200_not_declining: boolean;
  cond_within_52w_high_range: boolean;
  cond_outperform_index: boolean;
  cond_volatility_decreasing: boolean;
  cond_pullback_within_range: boolean;
  cond_volume_decrease_on_pullback: boolean;
}

export interface Stock {
  symbol: string;
  close: number;
  rs_percentile: number;
  rs_percentile_5days_ago: number;
  rs_change: number;
  returns: {
    r_12m: number;
    r_6m: number;
    r_3m: number;
    r_1m: number;
  };
}

export interface ScanResult {
  index: string;
  count: number;
  scanned_at: string;
  stocks: Stock[];
}

export interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export interface ScanOptions {
  index: IndexType;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

export interface QuarterlyFinancial {
  date: string;        // "2024-Q3" format
  revenue: number;     // Total revenue
  netIncome: number;   // Net income
}

export interface CompanyProfile {
  sector: string;
  industry: string;
  summary: string;
}

export interface RankedStock {
  rank: number;
  symbol: string;
  name: string;
  close: number;
  rs_percentile: number;
  rs_percentile_5days_ago: number;
  rs_change: number;
  sector: string;
  returns: { r_12m: number; r_6m: number; r_3m: number; r_1m: number };
}

export interface SectorCount {
  sector: string;
  count: number;
}

export interface RsRankingResult {
  count: number;
  scanned_at: string;
  stocks: RankedStock[];
  sectors: SectorCount[];
}
