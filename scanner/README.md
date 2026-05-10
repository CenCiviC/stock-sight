# Stock Scanner — EMA9/SMA50 Crossover

NASDAQ ~5000 종목 대상으로 미국장 마감 후 하루 1회 실행.
EMA9이 SMA50을 상향 돌파한 종목을 `data/alerts/latest.json`에 기록 (앱의 Today 탭이 이 파일을 읽어 표시).

## 돌파 조건

| 항목 | 기준 |
|---|---|
| **당일** | `EMA9 >= SMA50 × 0.95` |
| **전일** | `EMA9 < SMA50 × 0.95` |

두 조건이 동시에 충족될 때만 **돌파**로 판정.
`THRESHOLD = 0.95`는 `scanner.ts` 상단 상수로 조정 가능.

## 파일 구조

```
scanner/
  scanner.ts      # 메인 스캐너 (TypeScript)
  package.json    # 의존성 (tsx, typescript)
  tsconfig.json
  README.md
.github/
  workflows/
    market_scan.yml   # GitHub Actions 워크플로우
data/
  alerts/
    latest.json   # CI가 자동 갱신, 앱이 raw URL로 fetch
```

## 로컬 실행

```bash
cd scanner
npm install
npm run scan
# 또는
npx tsx scanner.ts
```

Node.js 18+ 필요 (빌트인 `fetch` 사용).

## GitHub Actions 설정

### 스케줄 변경

`.github/workflows/market_scan.yml`의 cron 수정:

```yaml
schedule:
  - cron: "30 21 * * 1-5"   # UTC 기준, 월~금
```

| cron (UTC) | EDT (여름) | EST (겨울) |
|---|---|---|
| `30 21 * * 1-5` | 17:30 ET | 16:30 ET |
| `0 23 * * 1-5` | 19:00 ET | 18:00 ET |

### 수동 실행

GitHub → **Actions → Market Scan → Run workflow**

## 파라미터 조정

`scanner.ts` 상단 상수:

| 상수 | 기본값 | 설명 |
|---|---|---|
| `THRESHOLD` | `0.95` | 돌파 판정 임계값 |
| `CONCURRENCY` | `5` | 동시 Yahoo Finance 요청 수 |
| `DELAY_MS` | `200` | 배치 간 딜레이 (ms) |
| `RETRY_MAX` | `3` | 429 응답 시 재시도 횟수 |
