export const DB_NAME = "stock_sight.db";
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  `PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    index_type TEXT    NOT NULL,
    count      INTEGER NOT NULL,
    scanned_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scans_index_type ON scans(index_type);
  CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at DESC);

  CREATE TABLE IF NOT EXISTS scan_stocks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id                 INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    symbol                  TEXT    NOT NULL,
    close                   REAL    NOT NULL,
    rs_percentile           REAL    NOT NULL,
    rs_percentile_5days_ago REAL    NOT NULL,
    rs_change               REAL    NOT NULL,
    r_12m                   REAL    NOT NULL,
    r_6m                    REAL    NOT NULL,
    r_3m                    REAL    NOT NULL,
    r_1m                    REAL    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scan_stocks_scan_id ON scan_stocks(scan_id);
  CREATE INDEX IF NOT EXISTS idx_scan_stocks_symbol ON scan_stocks(symbol);`,
];
