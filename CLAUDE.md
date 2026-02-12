# Stock Sight

VCP(Volatility Contraction Pattern) 기반 주식 스크리너 앱. NASDAQ, Russell 1000, S&P 500 인덱스를 스캔하여 기술적 조건을 만족하는 종목을 필터링.

## Tech Stack

- **Framework**: Expo SDK 54 + React Native 0.81.5 + React 19.1
- **Routing**: Expo Router 6 (file-based, typedRoutes)
- **Language**: TypeScript (strict mode)
- **Package Manager**: yarn (Yarn 4, `.yarnrc.yml` 설정 사용)
- **Fonts**: Inter (UI), JetBrains Mono (숫자/데이터)
- **Charts**: TradingView Lightweight Charts (WebView), react-native-svg

## Project Structure

```
app/                    # Expo Router 페이지
  _layout.tsx           # 루트 레이아웃 (폰트 로딩, Stack 네비게이션)
  index.tsx             # 메인 스캔 화면 (탭: NASDAQ/Russell/S&P)
  stock/[symbol].tsx    # 개별 종목 상세 (차트, RS, Returns, Financials)

components/ui/          # 재사용 UI 컴포넌트 (barrel export: index.ts)
  text.tsx              # StyledText (9 variants)
  price-text.tsx        # PriceText (JetBrains Mono)
  percentage-text.tsx   # PercentageText (초록/빨강 자동 색상)
  card.tsx              # Card (default/elevated/outlined)
  button.tsx            # Button (primary/secondary/ghost, sm/md/lg)
  badge.tsx             # Badge (success/warning/danger/info/neutral)
  progress-bar.tsx      # ProgressBar (Animated)
  divider.tsx           # Divider
  safe-area-view.tsx    # SafeAreaView wrapper
  stock-chart.tsx       # TradingView 캔들스틱 차트 (compact 모드 지원)
  financials-chart.tsx  # 분기별 매출/순이익 차트

constants/              # 디자인 토큰
  colors.ts             # 631 컬러 팔레트 (primary/secondary/accent_warm/accent_light + semantic)
  typography.ts         # 폰트 패밀리, 사이즈, 라인하이트, 웨이트
  spacing.ts            # spacing (xs~5xl), borderRadius
  shadows.ts            # 플랫폼별 그림자
  theme.ts              # barrel export

lib/scanner/            # VCP 스캐너 엔진 (barrel export: index.ts)
  types.ts              # IndexType, OHLCVBar, SymbolData, Stock, ScanResult 등
  indicators.ts         # trailingReturn, rollingSMA, rollingStd, rollingMax, calculateATR
  symbols.ts            # NASDAQ/Russell 1000/S&P 500 심볼 fetching
  yahoo.ts              # Yahoo Finance v8 차트 API, v10 재무 API
  vcp.ts                # 8가지 VCP 조건 검사 + RS 스코어 계산
  scanner.ts            # 5단계 스캔 파이프라인 오케스트레이터
  proxy.ts              # 플랫폼별 CORS 프록시 URL 변환 (web only)

metro.config.js         # CORS 프록시 미들웨어 (Yahoo/NASDAQ/iShares/Wikipedia)
```

## Design System

**631 Color Rule**: 60% primary(navy) / 30% secondary(slate) / 10% accent(sand+ivory)

- 배경: `colors.primary[950]` (가장 어두운 네이비)
- 카드 배경: `colors.primary[800]`
- 텍스트: `colors.accent_light[400]` (기본), `colors.secondary[*]` (보조)
- 강조: `colors.accent_warm[300]` (골드)
- 상승/하락: `colors.positive` / `colors.negative`

## Path Aliases

`@/*` → 프로젝트 루트 (tsconfig.json paths)

```typescript
import { colors } from "@/constants/colors";
import { StyledText } from "@/components/ui";
import { runScan } from "@/lib/scanner";
```

## CORS Proxy (Web)

Metro dev server 미들웨어가 외부 API 요청을 프록시. `lib/scanner/proxy.ts`의 `proxyUrl()`이 web 플랫폼에서만 URL 변환.

프록시 라우트: `/proxy/yahoo/`, `/proxy/nasdaq/`, `/proxy/ishares/`, `/proxy/wikipedia/`

## Commands

```bash
yarn start          # Expo dev server
yarn web            # 웹 브라우저로 실행
yarn ios            # iOS 시뮬레이터
yarn android        # Android 에뮬레이터
npx tsc --noEmit    # 타입 체크
yarn lint           # ESLint
```

## Git Rules

- **커밋은 반드시 사용자의 명시적 허락을 받은 후에만 실행**
- push, force push 등 원격 조작도 사용자 허락 필수

## Git Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/) 형식 사용:

```
<type>[optional scope][!]: <Description starting with uppercase>
```

### Types

| Type | 설명 |
|------|------|
| `feat` | 새 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 (기능 변경 없음) |
| `style` | 코드 포맷팅, 세미콜론 등 (기능 변경 없음) |
| `docs` | 문서 변경 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정, 의존성 등 |
| `perf` | 성능 개선 |

### Rules

- **Description은 대문자로 시작**: `feat: Add stock chart component`
- **Breaking change는 `!` 추가**: `refactor!: Change scanner API interface`
- **Scope은 선택사항**: `fix(scanner): Handle null price fallback`
- **본문은 필요시 추가** (빈 줄 후)

### Examples

```
feat: Add TradingView candlestick chart to stock detail
fix: Prevent concurrent scan race condition
refactor(ui): Extract compact chart mode from StockChart
style: Format imports with barrel exports
chore: Remove unused Python scanner and React logo assets
feat!: Replace REST API with local TypeScript scanner
```

## Important Notes

- 패키지 설치 시 `npx expo install <package>` 사용 (Expo SDK 호환성 보장)
- `daysToRange()` 매핑 주의: scanner는 `days=400` → `"2y"` 필요 (MA200 + 52주 고가 계산)
- 동시 스캔 방지: `scanningIndex` 상태로 한 번에 하나의 인덱스만 스캔
- TradingView Lightweight Charts는 Apache 2.0 — 워터마크 제거 시 앱 내 고지 필요
