import type { SQLiteDatabase } from "expo-sqlite";
import type { RsRankingResult, RankedStock } from "@/lib/scanner";
import type { RsRankingRecord, RankChange } from "./types";

/** Save an RS ranking result and keep only the latest 1 record */
export async function saveRsRanking(
  db: SQLiteDatabase,
  result: RsRankingResult
): Promise<number> {
  const insertResult = await db.runAsync(
    `INSERT INTO rs_rankings (count, scanned_at) VALUES (?, ?)`,
    result.count,
    result.scanned_at
  );
  const rankingId = insertResult.lastInsertRowId;

  for (const stock of result.stocks) {
    await db.runAsync(
      `INSERT INTO rs_ranking_stocks
       (ranking_id, rank, symbol, name, close, rs_percentile, rs_percentile_5days_ago,
        rs_change, r_12m, r_6m, r_3m, r_1m, sector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rankingId,
      stock.rank,
      stock.symbol,
      stock.name,
      stock.close,
      stock.rs_percentile,
      stock.rs_percentile_5days_ago,
      stock.rs_change,
      stock.returns.r_12m,
      stock.returns.r_6m,
      stock.returns.r_3m,
      stock.returns.r_1m,
      stock.sector
    );
  }

  // Keep only the latest record — delete all older ones
  await db.runAsync(
    `DELETE FROM rs_rankings WHERE id != ?`,
    rankingId
  );

  return rankingId;
}

/** Load the most recent RS ranking */
export async function getLatestRsRanking(
  db: SQLiteDatabase
): Promise<RsRankingRecord | null> {
  const row = await db.getFirstAsync<{
    id: number;
    count: number;
    scanned_at: string;
    created_at: string;
  }>(
    `SELECT id, count, scanned_at, created_at
     FROM rs_rankings ORDER BY scanned_at DESC LIMIT 1`
  );

  if (!row) return null;

  const stockRows = await db.getAllAsync<{
    rank: number;
    symbol: string;
    name: string;
    close: number;
    rs_percentile: number;
    rs_percentile_5days_ago: number;
    rs_change: number;
    r_12m: number;
    r_6m: number;
    r_3m: number;
    r_1m: number;
    sector: string;
  }>(
    `SELECT rank, symbol, name, close, rs_percentile, rs_percentile_5days_ago,
            rs_change, r_12m, r_6m, r_3m, r_1m, sector
     FROM rs_ranking_stocks WHERE ranking_id = ?
     ORDER BY rank ASC`,
    row.id
  );

  const stocks: RankedStock[] = stockRows.map((r) => ({
    rank: r.rank,
    symbol: r.symbol,
    name: r.name ?? "",
    close: r.close,
    rs_percentile: r.rs_percentile,
    rs_percentile_5days_ago: r.rs_percentile_5days_ago,
    rs_change: r.rs_change,
    sector: r.sector,
    returns: {
      r_12m: r.r_12m,
      r_6m: r.r_6m,
      r_3m: r.r_3m,
      r_1m: r.r_1m,
    },
  }));

  return { ...row, stocks };
}

/** Compare current and previous rankings to compute rank changes */
export function compareRankings(
  current: RankedStock[],
  previous: RankedStock[]
): Map<string, RankChange> {
  const prevRankMap = new Map<string, number>();
  for (const stock of previous) {
    prevRankMap.set(stock.symbol, stock.rank);
  }

  const changes = new Map<string, RankChange>();
  for (const stock of current) {
    const prev_rank = prevRankMap.get(stock.symbol) ?? null;
    const rank_delta = prev_rank != null ? prev_rank - stock.rank : null;

    changes.set(stock.symbol, {
      symbol: stock.symbol,
      current_rank: stock.rank,
      prev_rank,
      rank_delta,
    });
  }

  return changes;
}
