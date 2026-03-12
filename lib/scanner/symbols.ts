import type { IndexType } from "./types";
import { proxyUrl } from "./proxy";

/**
 * Main entry point: fetch symbols for a given index.
 */
export async function getSymbols(index: IndexType): Promise<string[]> {
  if (index === "nasdaq") {
    return fetchNasdaqSymbols();
  } else if (index === "russell_1000") {
    return fetchRussell1000Symbols();
  } else if (index === "sp500") {
    return fetchSP500Symbols();
  }
  throw new Error(`Unsupported index: ${index}`);
}

/**
 * Fetch NASDAQ symbols from NASDAQ Screener API.
 * Port of symbols.py _fetch_nasdaq_symbols.
 */
async function fetchNasdaqSymbols(limit: number = 5000): Promise<string[]> {
  const rawUrl =
    `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}`;

  try {
    const resp = await fetch(proxyUrl(rawUrl), {
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = await resp.json();
    const rows: Array<{ symbol?: string }> =
      json?.data?.table?.rows ?? [];

    const symbols: string[] = [];
    for (const row of rows) {
      const sym = (row.symbol ?? "").trim().toUpperCase();
      if (sym) {
        symbols.push(sym);
      }
    }

    return normalizeSymbols(symbols);
  } catch (e) {
    console.warn("[symbols] Failed to fetch NASDAQ symbols:", e);
    return [];
  }
}

/**
 * Fetch NASDAQ symbols sorted by market cap (descending).
 * Returns symbols in market-cap order (largest first).
 */
export async function fetchNasdaqSymbolsByMarketCap(
  limit: number = 5000
): Promise<string[]> {
  const rawUrl =
    `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&sortcolumn=marketcap&sortorder=desc`;

  try {
    const resp = await fetch(proxyUrl(rawUrl), {
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = await resp.json();
    const rows: Array<{ symbol?: string; marketCap?: string }> =
      json?.data?.table?.rows ?? [];

    // Keep insertion order (already sorted by market cap from API)
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const row of rows) {
      const sym = (row.symbol ?? "").replace(/\./g, "-").trim().toUpperCase();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        symbols.push(sym);
      }
    }

    return symbols;
  } catch (e) {
    console.warn("[symbols] Failed to fetch NASDAQ symbols by market cap:", e);
    return [];
  }
}

/**
 * Fetch Russell 1000 symbols from iShares IWB ETF holdings CSV.
 * Falls back to an empty array on failure.
 */
async function fetchRussell1000Symbols(): Promise<string[]> {
  const rawUrl =
    "https://www.ishares.com/us/products/239707/ishares-russell-1000-etf/" +
    "1467271812596.ajax?fileType=csv&fileName=IWB_holdings&dataType=fund";

  try {
    const resp = await fetch(proxyUrl(rawUrl));
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const text = await resp.text();
    const lines = text.split("\n");

    // Find header row containing "Ticker"
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("Ticker")) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      console.warn("[symbols] Could not find Ticker header in iShares CSV");
      return [];
    }

    // Parse CSV: identify Ticker column index from header
    const headerCols = parseCSVLine(lines[headerIdx]);
    const tickerColIdx = headerCols.findIndex(
      (col) => col.trim().toUpperCase() === "TICKER"
    );
    if (tickerColIdx === -1) {
      console.warn("[symbols] Ticker column not found in header");
      return [];
    }

    const symbols: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCSVLine(line);
      const ticker = (cols[tickerColIdx] ?? "").trim().toUpperCase();

      // Skip empty, dash-only, or dash-prefixed values
      if (ticker && ticker !== "-" && !ticker.startsWith("-")) {
        symbols.push(ticker);
      }
    }

    return normalizeSymbols(symbols);
  } catch (e) {
    console.warn("[symbols] Failed to fetch Russell 1000 from iShares:", e);
    return [];
  }
}

/**
 * Fetch S&P 500 symbols by parsing the Wikipedia page.
 * Extracts ticker symbols from the first HTML table with a "Symbol" column.
 */
async function fetchSP500Symbols(): Promise<string[]> {
  const rawUrl = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

  try {
    const url = proxyUrl(rawUrl);
    console.log(`[symbols] Fetching S&P 500 from: ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const html = await resp.text();
    console.log(`[symbols] Wikipedia HTML received: ${html.length} chars`);
    const symbols = extractSymbolsFromWikipediaTable(html, "Symbol");
    console.log(`[symbols] S&P 500 symbols extracted: ${symbols.length}`);

    const normalized = normalizeSymbols(symbols);
    console.log(`[symbols] S&P 500 after normalization: ${normalized.length}`);
    return normalized;
  } catch (e) {
    console.warn("[symbols] Failed to fetch S&P 500 from Wikipedia:", e);
    return [];
  }
}

/**
 * Extract ticker symbols from the first HTML table that has a column
 * matching `columnName` (case-insensitive).
 */
function extractSymbolsFromWikipediaTable(
  html: string,
  columnName: string
): string[] {
  // Find all <table> blocks
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];

    // Extract header cells from the first <tr> that contains <th>
    const headerRowMatch = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (!headerRowMatch) continue;

    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    const headers: string[] = [];
    let thMatch: RegExpExecArray | null;
    while ((thMatch = thRegex.exec(headerRowMatch[1])) !== null) {
      headers.push(stripHtml(thMatch[1]).trim());
    }

    // Find the column index matching our target
    const colIdx = headers.findIndex(
      (h) => h.toLowerCase() === columnName.toLowerCase()
    );
    if (colIdx === -1) continue;

    // Extract data rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const symbols: string[] = [];
    let rowMatch: RegExpExecArray | null;
    let isFirstRow = true;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      // Skip header row
      if (isFirstRow) {
        isFirstRow = false;
        continue;
      }

      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripHtml(tdMatch[1]).trim());
      }

      if (cells.length > colIdx) {
        const sym = cells[colIdx].trim().toUpperCase();
        if (sym) {
          symbols.push(sym);
        }
      }
    }

    if (symbols.length > 0) {
      return symbols;
    }
  }

  return [];
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);

  return result;
}

/**
 * Normalize symbols for Yahoo Finance compatibility:
 * - Replace "." with "-" (e.g. BRK.B -> BRK-B)
 * - Trim whitespace
 * - Remove empty values
 * - Deduplicate and sort
 */
export function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of symbols) {
    const s = raw.replace(/\./g, "-").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    result.push(s);
  }

  return result.sort();
}
