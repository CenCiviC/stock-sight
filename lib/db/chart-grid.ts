import type { SQLiteDatabase } from "expo-sqlite";
import type { OHLCVBar } from "@/lib/scanner";
import type { ChartGridRecord } from "./types";

/** Save chart grid result and keep only the latest 1 record */
export async function saveChartGrid(
  db: SQLiteDatabase,
  items: { symbol: string; bars: OHLCVBar[] }[]
): Promise<number> {
  const scannedAt = new Date().toISOString();

  const insertResult = await db.runAsync(
    `INSERT INTO chart_grids (count, scanned_at) VALUES (?, ?)`,
    items.length,
    scannedAt
  );
  const gridId = insertResult.lastInsertRowId;

  for (const item of items) {
    await db.runAsync(
      `INSERT INTO chart_grid_stocks (grid_id, symbol, bars) VALUES (?, ?, ?)`,
      gridId,
      item.symbol,
      JSON.stringify(item.bars)
    );
  }

  // Keep only the latest record
  await db.runAsync(`DELETE FROM chart_grids WHERE id != ?`, gridId);

  return gridId;
}

/** Load the most recent chart grid */
export async function getLatestChartGrid(
  db: SQLiteDatabase
): Promise<ChartGridRecord | null> {
  const row = await db.getFirstAsync<{
    id: number;
    count: number;
    scanned_at: string;
    created_at: string;
  }>(
    `SELECT id, count, scanned_at, created_at
     FROM chart_grids ORDER BY scanned_at DESC LIMIT 1`
  );

  if (!row) return null;

  const stockRows = await db.getAllAsync<{
    symbol: string;
    bars: string;
  }>(
    `SELECT symbol, bars FROM chart_grid_stocks WHERE grid_id = ?`,
    row.id
  );

  const items = stockRows.map((r) => ({
    symbol: r.symbol,
    bars: JSON.parse(r.bars) as OHLCVBar[],
  }));

  return { ...row, items };
}
