export const DB_NAME = "stock_sight.db";
export const SCHEMA_VERSION = 3;

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

  `CREATE TABLE IF NOT EXISTS rs_rankings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    count      INTEGER NOT NULL,
    scanned_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rs_ranking_stocks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    ranking_id              INTEGER NOT NULL REFERENCES rs_rankings(id) ON DELETE CASCADE,
    rank                    INTEGER NOT NULL,
    symbol                  TEXT    NOT NULL,
    close                   REAL    NOT NULL,
    rs_percentile           REAL    NOT NULL,
    rs_percentile_5days_ago REAL    NOT NULL,
    rs_change               REAL    NOT NULL,
    r_12m                   REAL    NOT NULL,
    r_6m                    REAL    NOT NULL,
    r_3m                    REAL    NOT NULL,
    r_1m                    REAL    NOT NULL,
    sector                  TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_rs_ranking_stocks_ranking_id ON rs_ranking_stocks(ranking_id);`,

  `ALTER TABLE rs_ranking_stocks ADD COLUMN name TEXT NOT NULL DEFAULT '';`,
];
