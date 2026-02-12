export { initDb, saveScan, getScans, getScanById, getLatestScan, deleteScan, deleteAllScans } from "./database";
export { compareScanResults } from "./comparison";
export { DB_NAME } from "./schema";
export type { ScanSummary, ScanRecord, ComparisonResult, ComparisonStock } from "./types";
