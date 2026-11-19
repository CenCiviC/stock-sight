import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/constants/colors';
import { borderRadius, spacing } from '@/constants/spacing';
import { fonts } from '@/constants/typography';
import {
  EXT_MAX_GC,
  EXT_MIN_ATR,
  EXT_MIN_VEXP,
  G1_HOLD_DAYS,
  G1_STOP_PCT,
  G1_TAKE_PROFIT_PCT,
  G1_TIME_STOP_DAY,
  g1Exit,
  g1Progress,
  isExt,
  isHwak,
  type G1ExitState,
  type G1HistoryEntry,
} from '@/lib/alerts';
import type { OHLCVBar } from '@/lib/scanner';
import { StyledText } from './text';

interface G1HistoryCardProps {
  entry: G1HistoryEntry;
  /** 신호 이후 일봉. 아직 못 불러왔으면 undefined — 수익률 자리만 비워 둔다 */
  bars?: OHLCVBar[];
  onPress?: () => void;
  /**
   * today: Today 추천 카드 — 같은 골격에 수익률 대신 종가와 매매 계획(손절가·익절가).
   * 아직 진입 전이라 진행 바는 비어 있다.
   */
  variant?: 'history' | 'today';
}

/** 확장 등급 색 — 확대(금색)와 구분되는 청록 */
export const EXT_COLOR = '#7FD1C2';
const EXT_BORDER = 'rgba(127, 209, 194, 0.45)';
const EXT_FILL = 'rgba(127, 209, 194, 0.12)';
const HWAK_BORDER = 'rgba(225, 217, 188, 0.45)';

const STATE_STYLE: Record<G1ExitState, { label: string; fg: string; bg: string } | null> = {
  wait: null,
  live: null,
  stop: { label: `손절 −${G1_STOP_PCT}%`, fg: colors.negative, bg: 'rgba(248, 113, 113, 0.12)' },
  time: { label: `${G1_TIME_STOP_DAY}일 정리`, fg: colors.warning, bg: 'rgba(251, 191, 36, 0.12)' },
  tp: { label: `익절 +${G1_TAKE_PROFIT_PCT}%`, fg: colors.positive, bg: 'rgba(74, 222, 128, 0.12)' },
  expired: { label: '만기', fg: colors.secondary[500], bg: colors.primary[900] },
};

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtPx = (v: number) => `$${v.toFixed(2)}`;

/**
 * Today 탭 G1 카드 — 확장·확대 배지, 확장 판정 칩(거래량 또는 ATR, 그리고 GC),
 * 그리고 매매 규칙(−15% 손절 · 21일 본전 · +50% 익절)대로 들고 있었다면 지금 어떤지.
 * Today 추천(variant="today")과 히스토리가 같은 모양을 쓴다.
 */
export function G1HistoryCard({ entry, bars, onPress, variant = 'history' }: G1HistoryCardProps) {
  const isToday = variant === 'today';
  const ext = isExt(entry);
  const hwak = isHwak(entry);
  const exit = !isToday && bars ? g1Exit(entry.signalDate, bars) : null;
  const hold = exit && exit.state !== 'live' && exit.state !== 'wait' && bars
    ? g1Progress(entry.signalDate, bars)
    : null;

  const chips = [
    {
      label: '거래량',
      value: entry.vexp63 == null ? '—' : `×${entry.vexp63.toFixed(2)}`,
      on: entry.vexp63 != null && entry.vexp63 >= EXT_MIN_VEXP,
    },
    {
      label: 'ATR',
      value: `${entry.atrPct.toFixed(1)}%`,
      on: entry.atrPct >= EXT_MIN_ATR,
    },
    {
      label: 'GC',
      value: entry.gcDays == null ? '역배열' : `${entry.gcDays}일`,
      on: entry.gcDays == null || entry.gcDays <= EXT_MAX_GC,
    },
  ];

  const ret = exit?.returnPct;
  const retText = ret == null ? '—' : fmtPct(ret);
  const retColor =
    ret == null ? colors.secondary[600] : ret >= 0 ? colors.positive : colors.negative;
  const st = exit ? STATE_STYLE[exit.state] : null;

  let dayText = isToday ? '내일 시가 진입' : '';
  if (exit) {
    if (exit.state === 'wait') dayText = '진입 대기';
    else if (exit.state === 'live') dayText = `D+${exit.day}`;
    else if (exit.pending) dayText = '내일 시가 정리';
    else dayText = `D+${exit.day} 청산`;
  }

  const holdDays = exit ? exit.day : 0;
  const labels = [ext && '확장', hwak && '확대'].filter(Boolean).join('·') || 'G1';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        { borderColor: ext ? EXT_BORDER : hwak ? HWAK_BORDER : colors.primary[700] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.symbol} ${isToday ? '오늘' : entry.signalDate} G1 신호, ${labels}`}
    >
      <View style={styles.row}>
        <StyledText variant="body" weight="bold" color={colors.accent_light[400]}>
          {entry.symbol}
        </StyledText>
        {ext && (
          <View style={[styles.grade, { backgroundColor: EXT_COLOR }]}>
            <StyledText variant="caption" weight="bold" color={colors.primary[950]}>
              확장
            </StyledText>
          </View>
        )}
        {hwak && (
          <View style={[styles.grade, { backgroundColor: colors.accent_warm[300] }]}>
            <StyledText variant="caption" weight="bold" color={colors.primary[950]}>
              확대
            </StyledText>
          </View>
        )}
        {st && (
          <View style={[styles.state, { backgroundColor: st.bg }]}>
            <StyledText variant="caption" weight="semibold" color={st.fg}>
              {st.label}
            </StyledText>
          </View>
        )}
        {isToday ? (
          <StyledText
            variant="body"
            weight="semibold"
            color={colors.accent_light[400]}
            style={styles.ret}
          >
            {fmtPx(entry.close)}
          </StyledText>
        ) : (
          <StyledText variant="body" weight="semibold" color={retColor} style={styles.ret}>
            {retText}
          </StyledText>
        )}
      </View>

      <View style={styles.row}>
        {chips.map((c, i) => (
          <View key={c.label} style={styles.chipWrap}>
            {i === 1 && (
              <StyledText variant="caption" color={colors.secondary[800]}>
                또는
              </StyledText>
            )}
            <View style={[styles.chip, c.on && styles.chipOn]}>
              <View style={[styles.dot, c.on && styles.dotOn]} />
              <StyledText
                variant="caption"
                weight="semibold"
                color={c.on ? EXT_COLOR : colors.secondary[700]}
              >
                {c.label}
              </StyledText>
              <StyledText
                variant="caption"
                color={c.on ? EXT_COLOR : colors.secondary[700]}
                style={styles.mono}
              >
                {c.value}
              </StyledText>
            </View>
          </View>
        ))}
        <StyledText
          variant="caption"
          weight="semibold"
          color={(entry.votes ?? 0) >= 2 ? colors.accent_warm[300] : colors.secondary[600]}
          style={[styles.mono, styles.pushRight]}
        >
          {entry.votes ?? 0}/3
        </StyledText>
      </View>

      {/* 오늘 카드: 종가 기준 손절가·익절가 (실제 기준은 내일 시가라 ≈) */}
      {isToday && (
        <View style={styles.plan}>
          <View style={styles.planCell}>
            <StyledText variant="caption" color={colors.negative} style={styles.mono}>
              손절 ≈{fmtPx(entry.close * (1 - G1_STOP_PCT / 100))}
            </StyledText>
          </View>
          <View style={styles.planCell}>
            <StyledText variant="caption" color={colors.secondary[600]}>
              {G1_TIME_STOP_DAY}일 본전
            </StyledText>
          </View>
          <View style={styles.planCell}>
            <StyledText variant="caption" color={colors.positive} style={styles.mono}>
              익절 ≈{fmtPx(entry.close * (1 + G1_TAKE_PROFIT_PCT / 100))}
            </StyledText>
          </View>
        </View>
      )}

      <View style={styles.row}>
        {exit?.entryPrice != null && (
          <StyledText variant="caption" color={colors.secondary[600]} style={styles.mono}>
            진입 {fmtPx(exit.entryPrice)}
            {exit.state === 'live'
              ? ` · 익절가 ${fmtPx(exit.entryPrice * (1 + G1_TAKE_PROFIT_PCT / 100))}`
              : ''}
          </StyledText>
        )}
        {/* 규칙 없이 63일 들고 있었다면 — 손절이 무엇을 막았는지 */}
        {hold?.returnPct != null && (
          <StyledText variant="caption" color={colors.secondary[800]} style={styles.mono}>
            {hold.expired ? '63일 보유 시' : '계속 보유 시'} {fmtPct(hold.returnPct)}
          </StyledText>
        )}
        <StyledText
          variant="caption"
          color={colors.secondary[600]}
          style={[styles.mono, styles.pushRight]}
        >
          {dayText}
        </StyledText>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round((holdDays / G1_HOLD_DAYS) * 100)}%` },
          ]}
        />
        <View
          style={[styles.tick, { left: `${(G1_TIME_STOP_DAY / G1_HOLD_DAYS) * 100}%` }]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary[800],
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  grade: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 5,
  },
  state: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  ret: {
    marginLeft: 'auto',
    fontFamily: fonts.data,
  },
  chipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.primary[600],
  },
  chipOn: {
    borderColor: EXT_BORDER,
    backgroundColor: EXT_FILL,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  dotOn: {
    borderWidth: 0,
    backgroundColor: EXT_COLOR,
  },
  mono: {
    fontFamily: fonts.data,
  },
  pushRight: {
    marginLeft: 'auto',
  },
  plan: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  planCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: colors.primary[900],
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary[700],
  },
  fill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent_warm[800],
  },
  tick: {
    position: 'absolute',
    top: -3,
    width: 1,
    height: 9,
    backgroundColor: colors.secondary[700],
  },
});
