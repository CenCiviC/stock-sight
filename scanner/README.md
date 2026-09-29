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
  - cron: "17 22 * * 1-5"   # 본 실행 (월~금)
  - cron: "17 1 * * 2-6"    # 예비 — 전날 세션
  - cron: "17 4 * * 2-6"    # 예비 — 전날 세션
```

| cron (UTC) | EDT (여름) | EST (겨울) |
|---|---|---|
| `17 22 * * 1-5` | 18:17 ET | 17:17 ET |
| `17 1 * * 2-6` | 21:17 ET | 20:17 ET |
| `17 4 * * 2-6` | 00:17 ET | 23:17 ET |

GitHub cron은 수 시간 지연되거나 건너뛰는 일이 있어 세 번 건다. 스캐너는 SPY로
세션 날짜를 정하고, `g1.json`의 `scanDateET`가 이미 그 세션이면 바로 끝낸다.
Yahoo가 당일 봉을 늦게 주는 종목은 90초 간격으로 최대 3번 다시 받고, 그래도
3% 넘게 밀려 있으면 결과를 쓰지 않고 실패한다 (다음 예비 실행이 다시 시도).

### 수동 실행

GitHub → **Actions → Market Scan → Run workflow** (수동 실행은 `FORCE_SCAN=1`로 이미 스캔한 세션도 다시 돈다)

## 파라미터 조정

`scanner.ts` 상단 상수:

| 상수 | 기본값 | 설명 |
|---|---|---|
| `THRESHOLD` | `0.95` | 돌파 판정 임계값 |
| `CONCURRENCY` | `5` | 동시 Yahoo Finance 요청 수 |
| `DELAY_MS` | `200` | 배치 간 딜레이 (ms) |
| `RETRY_MAX` | `3` | 429 응답 시 재시도 횟수 |
