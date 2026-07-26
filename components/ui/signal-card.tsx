import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { Badge } from "./badge";
import { Card } from "./card";
import { PriceText } from "./price-text";
import { StyledText } from "./text";

import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import type { BuySignal, SellSignal, WatchItem } from "@/lib/signals";
import { factorLabel, stopRefLabel } from "@/lib/signals";

const FACTOR_ICON = {
  pass: { name: "checkmark-circle", color: colors.positive },
  fail: { name: "close-circle", color: colors.secondary[600] },
  // "지표가 없었다"와 "조건이 틀렸다"는 다른 사실이라 아이콘을 나눈다.
  unknown: { name: "help-circle", color: colors.secondary[700] },
  exempt: { name: "remove-circle", color: colors.accent_warm[400] },
} as const;

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? score / max : 0));
  return (
    <View style={styles.scoreBarTrack}>
      <View style={[styles.scoreBarFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

export function BuySignalCard({
  signal,
  onPress,
}: {
  signal: BuySignal;
  onPress?: () => void;
}) {
  const first = signal.tranches[0];
  return (
    <Card variant="elevated" onPress={onPress} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <StyledText variant="h3" weight="bold">
            {signal.symbol}
          </StyledText>
          <PriceText value={signal.close} />
        </View>
        <Badge label="매수" variant="success" />
      </View>

      <View style={styles.scoreRow}>
        <StyledText variant="caption" color={colors.secondary[600]}>
          점수 {signal.score}/{signal.scoreMax}
        </StyledText>
        <ScoreBar score={signal.score} max={signal.scoreMax} />
      </View>

      {/* 실행에 필요한 세 숫자를 한 줄로 — 손절, 손절폭, 비중 */}
      <View style={styles.planRow}>
        <View style={styles.planItem}>
          <StyledText variant="caption" color={colors.secondary[600]}>
            손절 ({stopRefLabel(signal.stopRef)})
          </StyledText>
          <PriceText value={signal.stopPrice} />
          <StyledText variant="caption" color={colors.negative}>
            -{signal.stopPct.toFixed(1)}%
          </StyledText>
        </View>
        <View style={styles.planItem}>
          <StyledText variant="caption" color={colors.secondary[600]}>
            비중
          </StyledText>
          <StyledText variant="body" weight="bold">
            {signal.positionPct.toFixed(0)}%
          </StyledText>
          <StyledText variant="caption" color={colors.secondary[600]}>
            계좌 리스크 {signal.accountRiskPct}%
          </StyledText>
        </View>
        <View style={styles.planItem}>
          <StyledText variant="caption" color={colors.secondary[600]}>
            ATR
          </StyledText>
          <StyledText variant="body" weight="bold">
            {signal.atrPct != null ? `${signal.atrPct.toFixed(1)}%` : "-"}
          </StyledText>
        </View>
      </View>

      <View style={styles.tranchePill}>
        <Ionicons name="layers-outline" size={12} color={colors.accent_warm[300]} />
        <StyledText variant="caption" color={colors.accent_warm[300]}>
          {signal.allIn
            ? "최고 조건 — 한 번에 전량"
            : `1차 ${first?.pct ?? 50}% 즉시 · 나머지는 거래대금 급증 시`}
        </StyledText>
      </View>

      <View style={styles.factorGrid}>
        {signal.factors.map((f) => {
          const icon = FACTOR_ICON[f.state];
          return (
            <View key={f.id} style={styles.factorItem}>
              <Ionicons name={icon.name} size={13} color={icon.color} />
              <StyledText
                variant="caption"
                color={
                  f.state === "pass" ? colors.accent_light[400] : colors.secondary[600]
                }
              >
                {factorLabel(f.id)}
              </StyledText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function SellSignalCard({
  signal,
  onPress,
}: {
  signal: SellSignal;
  onPress?: () => void;
}) {
  const up = signal.gainPct >= 0;
  return (
    <Card variant="elevated" onPress={onPress} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <StyledText variant="h3" weight="bold">
            {signal.symbol}
          </StyledText>
          <PriceText value={signal.close} />
        </View>
        <Badge label="매도" variant={up ? "warning" : "danger"} />
      </View>

      <View style={styles.planRow}>
        <View style={styles.planItem}>
          <StyledText variant="caption" color={colors.secondary[600]}>
            진입가
          </StyledText>
          <PriceText value={signal.entryPrice} />
        </View>
        <View style={styles.planItem}>
          <StyledText variant="caption" color={colors.secondary[600]}>
            손익
          </StyledText>
          <StyledText
            variant="body"
            weight="bold"
            color={up ? colors.positive : colors.negative}
          >
            {up ? "+" : ""}
            {signal.gainPct.toFixed(1)}%
          </StyledText>
        </View>
      </View>

      <View style={styles.reasonBox}>
        <Ionicons name="exit-outline" size={13} color={colors.negative} />
        <StyledText variant="caption" color={colors.accent_light[400]}>
          {signal.reason}
        </StyledText>
      </View>
    </Card>
  );
}

export function WatchCard({
  item,
  onPress,
}: {
  item: WatchItem;
  onPress?: () => void;
}) {
  return (
    <Card onPress={onPress} style={styles.watchCard}>
      <View style={styles.watchTop}>
        <StyledText variant="body" weight="bold">
          {item.symbol}
        </StyledText>
        <PriceText value={item.close} />
        <StyledText variant="caption" color={colors.secondary[600]}>
          {item.score}/{item.scoreMax}
        </StyledText>
      </View>
      {item.blockers.length > 0 && (
        <StyledText variant="caption" color={colors.secondary[700]} numberOfLines={2}>
          {item.blockers.join(" · ")}
        </StyledText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, gap: spacing.sm },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  scoreRow: { gap: spacing.xs },
  scoreBarTrack: {
    height: 4,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary[700],
    overflow: "hidden",
  },
  scoreBarFill: { height: "100%", backgroundColor: colors.accent_warm[300] },
  planRow: { flexDirection: "row", gap: spacing.lg },
  planItem: { gap: 2 },
  tranchePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary[700],
    alignSelf: "flex-start",
  },
  factorGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  factorItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  reasonBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary[700],
  },
  watchCard: { marginBottom: spacing.sm, gap: spacing.xs },
  watchTop: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
});
