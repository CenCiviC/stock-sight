import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import {
  BuySignalCard,
  SellSignalCard,
  WatchCard,
} from "@/components/ui/signal-card";
import { Divider, SafeAreaView, StyledText } from "@/components/ui";
import { colors } from "@/constants/colors";
import { borderRadius, spacing } from "@/constants/spacing";
import type { SignalFeed } from "@/lib/signals";
import { fetchSignalFeed } from "@/lib/signals";

export default function SignalsScreen() {
  const router = useRouter();
  const [feed, setFeed] = useState<SignalFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWatch, setShowWatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeed(await fetchSignalFeed());
    } catch (e) {
      setError(e instanceof Error ? e.message : "신호를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openStock = (symbol: string) => router.push(`/stock/${symbol}`);

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: "매매 신호" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.accent_warm[300]}
          />
        }
      >
        {feed && (
          <View style={styles.headerBox}>
            <View style={styles.headerRow}>
              <StyledText variant="caption" color={colors.secondary[600]}>
                {feed.asOf} · {feed.spec.name}
              </StyledText>
              <StyledText variant="caption" color={colors.secondary[600]}>
                {feed.universe.evaluated}종목 평가
              </StyledText>
            </View>
            <View style={styles.marketRow}>
              <Ionicons
                name={feed.market.spyUptrend ? "trending-up" : "trending-down"}
                size={14}
                color={
                  feed.market.spyUptrend ? colors.positive : colors.negative
                }
              />
              <StyledText variant="caption" color={colors.accent_light[400]}>
                시황: SPY {feed.market.spyUptrend ? "정배열" : "역배열"}
                {feed.market.spyGapPct != null &&
                  ` · 50/200 갭 ${feed.market.spyGapPct.toFixed(1)}%`}
              </StyledText>
            </View>
            {feed.universe.skippedForHistory > 0 && (
              // 데이터 공백이 "신호 없음"으로 읽히면 안 된다.
              <StyledText variant="caption" color={colors.accent_warm[400]}>
                히스토리 부족으로 제외 {feed.universe.skippedForHistory}종목
              </StyledText>
            )}
          </View>
        )}

        {loading && !feed && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent_warm[300]} />
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <StyledText variant="body" color={colors.negative}>
              {error}
            </StyledText>
          </View>
        )}

        {feed && (
          <>
            <Section
              title="오늘 살 것"
              count={feed.buy.length}
              icon="arrow-up-circle"
              tint={colors.positive}
            />
            {feed.buy.length === 0 ? (
              <Empty text="조건을 모두 통과한 종목이 없습니다" />
            ) : (
              feed.buy.map((s) => (
                <BuySignalCard
                  key={s.symbol}
                  signal={s}
                  onPress={() => openStock(s.symbol)}
                />
              ))
            )}

            <Divider style={styles.divider} />

            <Section
              title="오늘 팔 것"
              count={feed.sell.length}
              icon="arrow-down-circle"
              tint={colors.negative}
            />
            {!feed.portfolioTracked ? (
              // 보유 종목이 등록되지 않은 것과 매도 신호가 없는 것은 다르다.
              <Empty text="보유 종목이 등록되지 않아 매도 신호를 계산할 수 없습니다" />
            ) : feed.sell.length === 0 ? (
              <Empty text="청산 조건에 걸린 보유 종목이 없습니다" />
            ) : (
              feed.sell.map((s) => (
                <SellSignalCard
                  key={s.symbol}
                  signal={s}
                  onPress={() => openStock(s.symbol)}
                />
              ))
            )}

            <Divider style={styles.divider} />

            <Pressable
              style={styles.watchToggle}
              onPress={() => setShowWatch((v) => !v)}
            >
              <Section
                title="주시종목"
                count={feed.watchTotal}
                icon="eye-outline"
                tint={colors.accent_warm[300]}
              />
              <Ionicons
                name={showWatch ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.secondary[600]}
              />
            </Pressable>
            {showWatch && (
              <>
                <StyledText
                  variant="caption"
                  color={colors.secondary[700]}
                  style={styles.watchHint}
                >
                  골든크로스 상태를 유지 중이지만 아직 조건이 안 맞는 종목.
                  데드크로스가 나기 전까지 계속 지켜봅니다.
                </StyledText>
                {feed.watch.map((w) => (
                  <WatchCard
                    key={w.symbol}
                    item={w}
                    onPress={() => openStock(w.symbol)}
                  />
                ))}
                {feed.watchTotal > feed.watch.length && (
                  <StyledText variant="caption" color={colors.secondary[700]}>
                    외 {feed.watchTotal - feed.watch.length}종목
                  </StyledText>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  count,
  icon,
  tint,
}: {
  title: string;
  count: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={tint} />
      <StyledText variant="h3" weight="bold">
        {title}
      </StyledText>
      <View style={[styles.countPill, { borderColor: tint }]}>
        <StyledText variant="caption" color={tint} weight="bold">
          {count}
        </StyledText>
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.emptyBox}>
      <StyledText variant="caption" color={colors.secondary[700]}>
        {text}
      </StyledText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary[950] },
  content: { padding: spacing.lg, paddingBottom: spacing["4xl"] },
  headerBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[800],
    marginBottom: spacing.lg,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  marketRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  countPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  divider: { marginVertical: spacing.xl },
  emptyBox: {
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[800],
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing["3xl"], alignItems: "center" },
  errorBox: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[800],
    marginBottom: spacing.lg,
  },
  watchToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  watchHint: { marginBottom: spacing.md },
});
