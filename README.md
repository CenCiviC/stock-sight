# Stock Sight

VCP(Volatility Contraction Pattern) 기반 주식 스크리너 + RS(Relative Strength) 랭킹 앱.

S&P 500 전체에서 RS 상위 100개 종목을 랭킹하고, NASDAQ/Russell 1000/S&P 500 인덱스를 스캔하여 VCP 기술적 조건을 만족하는 종목을 필터링합니다.

## Features

- **RS Top 100** — S&P 500 전체에서 Relative Strength 상위 100개 종목 랭킹
  - 섹터 분포 시각화 (stacked bar + legend)
  - 리스캔 시 순위 변동(▲/▼/NEW/━) 및 섹터 변동(+N/-N) 표시
- **VCP Scanner** — NASDAQ, Russell 1000, S&P 500 인덱스별 VCP 조건 스캔
  - 8가지 기술적 조건 + RS percentile >= 70 필터
  - 리스캔 시 종목 비교 (NEW/RS delta)
- **종목 상세** — 캔들스틱 차트, RS percentile, 기간별 수익률, 분기 재무제표
- **데이터 저장** — SQLite로 스캔 결과 및 RS 랭킹 영구 저장
- **크로스 플랫폼** — iOS, Android, Web 지원

## Tech Stack

- **Framework**: Expo SDK 54 + React Native 0.81.5 + React 19.1
- **Routing**: Expo Router 6 (file-based, typedRoutes)
- **Language**: TypeScript (strict mode)
- **Database**: expo-sqlite (SQLite, WAL mode)
- **Package Manager**: yarn (Yarn 4)
- **Fonts**: Inter (UI), JetBrains Mono (숫자/데이터)
- **Charts**: TradingView Lightweight Charts (WebView), react-native-svg

## Project Structure

```
app/                        # Expo Router 페이지
  _layout.tsx               # 루트 레이아웃 (폰트 로딩, SQLite Provider, Stack)
  index.tsx                 # 메인 화면 (탭: RS Top / NASDAQ / Russell / S&P)
  history.tsx               # 스캔 히스토리
  stock/[symbol].tsx        # 종목 상세 (차트, RS, Returns, Financials)

components/ui/              # 재사용 UI 컴포넌트 (barrel export: index.ts)
  text.tsx                  # StyledText (9 variants)
  price-text.tsx            # PriceText (JetBrains Mono)
  percentage-text.tsx       # PercentageText (초록/빨강 자동 색상)
  card.tsx                  # Card (default/elevated/outlined)
  button.tsx                # Button (primary/secondary/ghost, sm/md/lg)
  badge.tsx                 # Badge (success/warning/danger/info/neutral)
  progress-bar.tsx          # ProgressBar (Animated)
  divider.tsx               # Divider
  safe-area-view.tsx        # SafeAreaView wrapper
  stock-card.tsx            # VCP 스캔 결과 종목 카드
  stock-chart.tsx           # TradingView 캔들스틱 차트 (compact 모드 지원)
  financials-chart.tsx      # 분기별 매출/순이익 차트
  ranking-card.tsx          # RS 랭킹 종목 카드 (순위 변동 badge)
  sector-chart.tsx          # 섹터 분포 시각화 (stacked bar + legend)

constants/                  # 디자인 토큰
  colors.ts                 # 631 컬러 팔레트 (primary/secondary/accent_warm/accent_light + semantic)
  typography.ts             # 폰트 패밀리, 사이즈, 라인하이트, 웨이트
  spacing.ts                # spacing (xs~5xl), borderRadius
  shadows.ts                # 플랫폼별 그림자
  theme.ts                  # barrel export

lib/scanner/                # 스캐너 엔진 (barrel export: index.ts)
  types.ts                  # IndexType, Stock, RankedStock, ScanResult, RsRankingResult 등
  indicators.ts             # trailingReturn, rollingSMA, rollingStd, rollingMax, calculateATR
  symbols.ts                # NASDAQ/Russell 1000/S&P 500 심볼 fetching
  yahoo.ts                  # Yahoo Finance v8 차트 API, v10 재무/프로필 API
  vcp.ts                    # 8가지 VCP 조건 검사 + RS 스코어 계산
  scanner.ts                # VCP 스캔 파이프라인 (5단계)
  rs-scanner.ts             # RS-only 스캔 파이프라인 (6단계, S&P 500 Top 100)
  proxy.ts                  # 플랫폼별 CORS 프록시 URL 변환 (web only)

lib/db/                     # SQLite 데이터 계층 (barrel export: index.ts)
  schema.ts                 # 스키마 정의 + 마이그레이션 (v1~v3)
  types.ts                  # ScanRecord, RsRankingRecord, RankChange 등
  database.ts               # VCP 스캔 CRUD (scans, scan_stocks)
  rs-ranking.ts             # RS 랭킹 CRUD (rs_rankings, rs_ranking_stocks)
  comparison.ts             # 스캔 결과 비교 (common/new/dropped)

metro.config.js             # CORS 프록시 미들웨어 (Yahoo/NASDAQ/iShares/Wikipedia)
```

## Getting Started

```bash
# 의존성 설치
yarn install

# 개발 서버 시작
yarn start

# 플랫폼별 실행
yarn web            # 웹 브라우저
yarn ios            # iOS 시뮬레이터
yarn android        # Android 에뮬레이터
```

## Design System

**631 Color Rule**: 60% primary(navy) / 30% secondary(slate) / 10% accent(sand+ivory)

- 배경: `colors.primary[950]` (가장 어두운 네이비)
- 카드 배경: `colors.primary[800]`
- 텍스트: `colors.accent_light[400]` (기본), `colors.secondary[*]` (보조)
- 강조: `colors.accent_warm[300]` (골드)
- 상승/하락: `colors.positive` / `colors.negative`

## Database Schema

SQLite 3개 마이그레이션:

- **v1**: `scans` + `scan_stocks` — VCP 스캔 결과 저장
- **v2**: `rs_rankings` + `rs_ranking_stocks` — RS 랭킹 저장
- **v3**: `rs_ranking_stocks.name` 컬럼 추가 — 기업명 저장

## CORS Proxy (Web)

Metro dev server 미들웨어가 외부 API 요청을 프록시합니다. `lib/scanner/proxy.ts`의 `proxyUrl()`이 web 플랫폼에서만 URL을 변환합니다.

프록시 라우트: `/proxy/yahoo/`, `/proxy/nasdaq/`, `/proxy/ishares/`, `/proxy/wikipedia/`

## License

TradingView Lightweight Charts — Apache 2.0 (앱 내 고지 포함)
