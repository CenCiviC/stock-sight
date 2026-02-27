import type { SQLiteDatabase } from "expo-sqlite";
import type { IndexType, ScanResult, Stock } from "@/lib/scanner";
import type { ScanSummary, ScanRecord } from "./types";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema";

/** Run migrations up to SCHEMA_VERSION */
export async function initDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const result = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const currentVersion = result?.user_version ?? 0;

  for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
    await db.execAsync(MIGRATIONS[v]);
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/** Save a ScanResult and return the new scan id */
export async function saveScan(
  db: SQLiteDatabase,
  scanResult: ScanResult
): Promise<number> {
  const insertResult = await db.runAsync(
    `INSERT INTO scans (index_type, count, scanned_at) VALUES (?, ?, ?)`,
    scanResult.index,
    scanResult.count,
    scanResult.scanned_at
  );
  const scanId = insertResult.lastInsertRowId;

  for (const stock of scanResult.stocks) {
    await db.runAsync(
      `INSERT INTO scan_stocks
       (scan_id, symbol, close, rs_percentile, rs_percentile_5days_ago,
        rs_change, r_12m, r_6m, r_3m, r_1m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scanId,
      stock.symbol,
      stock.close,
      stock.rs_percentile,
      stock.rs_percentile_5days_ago,
      stock.rs_change,
      stock.returns.r_12m,
      stock.returns.r_6m,
      stock.returns.r_3m,
      stock.returns.r_1m
    );
  }

  return scanId;
}

/** Get scan summaries, optionally filtered by index type */
export async function getScans(
  db: SQLiteDatabase,
  indexType?: IndexType
): Promise<ScanSummary[]> {
  if (indexType) {
    return db.getAllAsync<ScanSummary>(
      `SELECT id, index_type, count, scanned_at, created_at
       FROM scans WHERE index_type = ? ORDER BY scanned_at DESC`,
      indexType
    );
  }
  return db.getAllAsync<ScanSummary>(
    `SELECT id, index_type, count, scanned_at, created_at
     FROM scans ORDER BY scanned_at DESC`
  );
}

/** Get a full scan record including stocks */
export async function getScanById(
  db: SQLiteDatabase,
  scanId: number
): Promise<ScanRecord | null> {
  const scan = await db.getFirstAsync<ScanSummary>(
    `SELECT id, index_type, count, scanned_at, created_at
     FROM scans WHERE id = ?`,
    scanId
  );
  if (!scan) return null;

  const rows = await db.getAllAsync<{
    symbol: string;
    close: number;
    rs_percentile: number;
    rs_percentile_5days_ago: number;
    rs_change: number;
    r_12m: number;
    r_6m: number;
    r_3m: number;
    r_1m: number;
  }>(
    `SELECT symbol, close, rs_percentile, rs_percentile_5days_ago,
            rs_change, r_12m, r_6m, r_3m, r_1m
     FROM scan_stocks WHERE scan_id = ?
     ORDER BY rs_percentile DESC`,
    scanId
  );

  const stocks: Stock[] = rows.map((r) => ({
    symbol: r.symbol,
    close: r.close,
    rs_percentile: r.rs_percentile,
    rs_percentile_5days_ago: r.rs_percentile_5days_ago,
    rs_change: r.rs_change,
    returns: {
      r_12m: r.r_12m,
      r_6m: r.r_6m,
      r_3m: r.r_3m,
      r_1m: r.r_1m,
    },
  }));

  return { ...scan, stocks };
}

/** Get the most recent scan for a given index */
export async function getLatestScan(
  db: SQLiteDatabase,
  indexType: IndexType
): Promise<ScanRecord | null> {
  const scan = await db.getFirstAsync<ScanSummary>(
    `SELECT id, index_type, count, scanned_at, created_at
     FROM scans WHERE index_type = ? ORDER BY scanned_at DESC LIMIT 1`,
    indexType
  );
  if (!scan) return null;
  return getScanById(db, scan.id);
}

/** Get the second most recent scan for a given index (for comparison on mount) */
export async function getPreviousScan(
  db: SQLiteDatabase,
  indexType: IndexType
): Promise<ScanRecord | null> {
  const scan = await db.getFirstAsync<ScanSummary>(
    `SELECT id, index_type, count, scanned_at, created_at
     FROM scans WHERE index_type = ? ORDER BY scanned_at DESC LIMIT 1 OFFSET 1`,
    indexType
  );
  if (!scan) return null;
  return getScanById(db, scan.id);
}

/** Delete a single scan (CASCADE removes its stocks) */
export async function deleteScan(
  db: SQLiteDatabase,
  scanId: number
): Promise<void> {
  await db.runAsync(`DELETE FROM scans WHERE id = ?`, scanId);
}

/** Delete all scans across all indices */
export async function deleteAllScans(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(`DELETE FROM scans`);
}
