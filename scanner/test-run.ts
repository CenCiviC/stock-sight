/**
 * Quick smoke test — NASDAQ fetch + 10종목 스캔 + 결과 출력 (Discord 전송 없음)
 * 실행: npx tsx test-run.ts
 */

const THRESHOLD_LOW  = 0.97;
const THRESHOLD_HIGH = 1.03;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

async function fetchNasdaqSymbols(limit = 20): Promise<string[]> {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&sortcolumn=marketcap&sortorder=desc`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
  });
  if (!resp.ok) throw new Error(`NASDAQ API HTTP ${resp.status}`);
  const json = (await resp.json()) as { data?: { table?: { rows?: Array<{ symbol?: string }> } } };
  return (json?.data?.table?.rows ?? [])
    .map((r) => (r.symbol ?? "").replace(/\./g, "-").replace(/\//g, "-").trim().toUpperCase())
    .filter(Boolean);
}

async function fetchCloses(symbol: string): Promise<number[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=6mo&interval=1d`;
  const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (resp.status === 404 || resp.status === 422) return null;
  if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);
  type Json = { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> } };
  const json = (await resp.json()) as Json;
  const closes = (json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
    .filter((c): c is number => c != null);
  return closes.length >= 52 ? closes : null;
}

async function main() {
  const limit = Number(process.env["LIMIT"] ?? 20);
  const webhookUrl = (process.env["DISCORD_WEBHOOK_URL"] ?? "").trim();
  console.log(`=== Smoke Test (${limit}종목, Discord ${webhookUrl ? "ON" : "OFF"}) ===\n`);

  // 1. NASDAQ symbols
  console.log(`1) NASDAQ API 조회 (시총 상위 ${limit}개)...`);
  const symbols = await fetchNasdaqSymbols(limit);
  console.log(`   OK — ${symbols.length}개: ${symbols.join(", ")}\n`);

  // 2. 각 종목 스캔
  console.log("2) Yahoo Finance 스캔...");
  const crossed: string[] = [];

  for (const sym of symbols) {
    try {
      const closes = await fetchCloses(sym);
      if (!closes) { console.log(`   [${sym}] 데이터 없음`); continue; }

      const ema9 = calcEMA(closes, 9);
      const sma50 = calcSMA(closes, 50);
      const todayRatio = ema9.at(-1)! / (sma50.at(-1) ?? 1);
      const prevRatio = ema9.at(-2)! / (sma50.at(-2) ?? 1);
      const prevEma9 = ema9.at(-2)!;
      const hit = todayRatio >= THRESHOLD_LOW && todayRatio <= THRESHOLD_HIGH && ema9.at(-1)! > prevEma9;

      console.log(
        `   [${sym.padEnd(6)}] Close=$${closes.at(-1)!.toFixed(2).padStart(8)} | ` +
        `EMA9=${ema9.at(-1)!.toFixed(2).padStart(8)} | ` +
        `SMA50=${(sma50.at(-1) ?? 0).toFixed(2).padStart(8)} | ` +
        `ratio=${todayRatio.toFixed(3)} | ${hit ? "🟢 CROSSED" : "—"}`
      );
      if (hit) crossed.push(sym);
    } catch (e) {
      console.log(`   [${sym}] Error: ${e}`);
    }
  }

  console.log(`\n=== 결과: ${crossed.length}개 돌파 종목 ${crossed.length ? crossed.join(", ") : "(없음)"} ===`);

  if (webhookUrl) {
    const description = crossed.length
      ? crossed.map(s => `🟢 **${s}**`).join("\n")
      : "조건을 충족하는 종목이 없습니다.";
    const payload = {
      embeds: [{
        title: crossed.length ? `📈 EMA9 상향 돌파 — ${crossed.length}종목 감지 (테스트)` : "📭 돌파 종목 없음 (테스트)",
        description,
        color: crossed.length ? 0xf0b429 : 0x6b7280,
        footer: { text: `시총 상위 ${limit}종목 테스트 스캔` },
      }],
    };
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log(`Discord 전송: HTTP ${resp.status}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
