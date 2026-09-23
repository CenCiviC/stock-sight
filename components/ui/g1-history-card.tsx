import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/constants/colors';
import { borderRadius, spacing } from '@/constants/spacing';
import { fonts } from '@/constants/typography';
import {
  G1_HOLD_DAYS,
  g1Grade,
  g1Progress,
  TIER_MIN_ATR_RANK,
  TIER_MIN_BELOW_DAYS,
  TIER_MIN_VEXP,
  type G1Grade,
  type G1HistoryEntry,
} from '@/lib/alerts';
import type { OHLCVBar } from '@/lib/scanner';
import { StyledText } from './text';

interface G1HistoryCardProps {
  entry: G1HistoryEntry;
  /** 신호 이후 일봉. 아직 못 불러왔으면 undefined — 수익률 자리만 비워 둔다 */
  bars?: OHLCVBar[];
  onPress?: () => void;
}

const GRADE_STYLE: Record<G1Grade, { fg: string; bg: string; border: string }> = {
  확대: { fg: colors.primary[950], bg: colors.accent_warm[300], border: 'rgba(225, 217, 188, 0.45)' },
  기본: { fg: colors.secondary[300], bg: colors.primary[500], border: colors.primary[700] },
  축소: { fg: colors.secondary[600], bg: colors.primary[900], border: colors.primary[700] },
};

/**
 * Today 탭 "최근 30일 G1" 카드 — 신호 당일 3표가 어떤 조건으로 나왔는지,
 * 50/200 골든크로스 경과, 그리고 신호 다음 날 시가에 샀다면 지금 어떤지.
 */
export function G1HistoryCard({ entry, bars, onPress }: G1HistoryCardProps) {
  const grade = g1Grade(entry.votes, entry.gcDays);
  const gs = GRADE_STYLE[grade];
  const progress = bars ? g1Progress(entry.signalDate, bars) : null;

  const chips = [
    {
      label: '역배열',
      value: entry.belowDays == null ? '—' : `${entry.belowDays}일`,
      on: entry.belowDays != null && entry.belowDays >= TIER_MIN_BELOW_DAYS,
    },
    {
      label: 'ATR%ile',
      value: entry.atrRank252 == null ? '—' : entry.atrRank252.toFixed(0),
      on: entry.atrRank252 != null && entry.atrRank252 >= TIER_MIN_ATR_RANK,
    },
    {
      label: '거래량',
      value: entry.vexp63 == null ? '—' : `×${entry.vexp63.toFixed(2)}`,
      on: entry.vexp63 != null && entry.vexp63 >= TIER_MIN_VEXP,
    },
  ];

  const ret = progress?.returnPct;
  const retText = ret == null ? '—' : `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`;
  const retColor =
    ret == null ? colors.secondary[600] : ret >= 0 ? colors.positive : colors.negative;

  let dayText = '';
  if (progress) {
    if (progress.entryPrice == null) dayText = '진입 대기';
    else if (progress.expired) dayText = '만기';
    else dayText = `D+${progress.day}`;
  }

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { borderColor: gs.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.symbol} ${entry.signalDate} G1 신호, ${grade}, ${entry.votes}표`}
    >
      <View style={styles.row}>
        <StyledText variant="body" weight="bold" color={colors.accent_light[400]}>
          {entry.symbol}
        </StyledText>
        <View style={[styles.grade, { backgroundColor: gs.bg }]}>
          <StyledText variant="caption" weight="bold" color={gs.fg}>
            {grade}
          </StyledText>
        </View>
        <StyledText variant="body" weight="semibold" color={retColor} style={styles.ret}>
          {retText}
        </StyledText>
      </View>

      <View style={styles.row}>
        {chips.map((c) => (
          <View key={c.label} style={[styles.chip, c.on && styles.chipOn]}>
            <View style={[styles.dot, c.on && styles.dotOn]} />
            <StyledText
              variant="caption"
              weight="semibold"
              color={c.on ? colors.accent_warm[300] : colors.secondary[700]}
            >
              {c.label}
            </StyledText>
            <StyledText
              variant="caption"
              color={c.on ? colors.accent_warm[300] : colors.secondary[700]}
              style={styles.mono}
            >
              {c.value}
            </StyledText>
          </View>
        ))}
        <StyledText
          variant="caption"
          weight="semibold"
          color={entry.votes >= 2 ? colors.accent_warm[300] : colors.secondary[600]}
          style={[styles.mono, styles.pushRight]}
        >
          {entry.votes}/3
        </StyledText>
      </View>

      <View style={styles.row}>
        <StyledText variant="caption" color={colors.secondary[600]}>
          {entry.gcDays == null ? '역배열' : `GC ${entry.gcDays}일`}
        </StyledText>
        {progress?.entryPrice != null && (
          <StyledText variant="caption" color={colors.secondary[600]} style={styles.mono}>
            진입 ${progress.entryPrice.toFixed(2)}
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
            { width: `${Math.round(((progress?.day ?? 0) / G1_HOLD_DAYS) * 100)}%` },
          ]}
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
    gap: spacing.sm,
  },
  grade: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 5,
  },
  ret: {
    marginLeft: 'auto',
    fontFamily: fonts.data,
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
    borderColor: 'rgba(225, 217, 188, 0.45)',
    backgroundColor: 'rgba(225, 217, 188, 0.14)',
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
    backgroundColor: colors.accent_warm[500],
  },
  mono: {
    fontFamily: fonts.data,
  },
  pushRight: {
    marginLeft: 'auto',
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary[700],
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    backgroundColor: colors.accent_warm[800],
  },
});
