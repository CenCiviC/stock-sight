import type { SQLiteDatabase } from "expo-sqlite";
import type { Stock } from "@/lib/scanner";
import type { FavoriteRecord } from "./types";

/** Add or update a favorite stock (INSERT OR REPLACE by unique symbol) */
export async function addFavorite(
  db: SQLiteDatabase,
  stock: Stock,
  sourceIndex: string
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO favorites
     (symbol, close, rs_percentile, rs_percentile_5days_ago, rs_change,
      r_12m, r_6m, r_3m, r_1m, failed_conditions, source_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stock.symbol,
    stock.close,
    stock.rs_percentile,
    stock.rs_percentile_5days_ago,
    stock.rs_change,
    stock.returns.r_12m,
    stock.returns.r_6m,
    stock.returns.r_3m,
    stock.returns.r_1m,
    "",
    sourceIndex
  );
}

/** Remove a favorite by symbol */
export async function removeFavorite(
  db: SQLiteDatabase,
  symbol: string
): Promise<void> {
  await db.runAsync(`DELETE FROM favorites WHERE symbol = ?`, symbol);
}

/** Get all favorites ordered by most recently added */
export async function getAllFavorites(
  db: SQLiteDatabase
): Promise<FavoriteRecord[]> {
  const rows = await db.getAllAsync<{
    id: number;
    symbol: string;
    close: number;
    rs_percentile: number;
    rs_percentile_5days_ago: number;
    rs_change: number;
    r_12m: number;
    r_6m: number;
    r_3m: number;
    r_1m: number;
    failed_conditions: string;
    source_index: string;
    favorited_at: string;
  }>(`SELECT * FROM favorites ORDER BY favorited_at DESC`);

  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    close: r.close,
    rs_percentile: r.rs_percentile,
    rs_change: r.rs_change,
    returns: {
      r_12m: r.r_12m,
      r_6m: r.r_6m,
      r_3m: r.r_3m,
      r_1m: r.r_1m,
    },
    failed_conditions: r.failed_conditions ? r.failed_conditions.split(",") : [],
    source_index: r.source_index,
    favorited_at: r.favorited_at,
  }));
}

/** Get the set of all favorited symbols (for quick lookup) */
export async function getFavoritedSymbols(
  db: SQLiteDatabase
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ symbol: string }>(
    `SELECT symbol FROM favorites`
  );
  return new Set(rows.map((r) => r.symbol));
}
