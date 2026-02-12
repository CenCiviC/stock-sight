import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { getScanById, getScans, compareScanResults } from "@/lib/db";
import type { ScanRecord, ComparisonResult } from "@/lib/db";
import type { Stock } from "@/lib/scanner";
import { StyledText, Badge, Divider, StockCard } from "@/components/ui";
import { colors } from "@/constants/colors";
import { spacing } from "@/constants/spacing";

type ViewTab = "all" | "new" | "common" | "dropped";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "common", label: "Common" },
  { key: "dropped", label: "Dropped" },
];

export default function HistoryDetail() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [scan, setScan] = useState<ScanRecord | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("all");

  useEffect(() => {
    (async () => {
      const scanRecord = await getScanById(db, Number(id));
      if (!scanRecord) return;
      setScan(scanRecord);

      // Find the previous scan of the same index
      const allScans = await getScans(db, scanRecord.index_type);
      const currentIdx = allScans.findIndex((s) => s.id === scanRecord.id);
      if (currentIdx >= 0 && currentIdx < allScans.length - 1) {
        const prevScan = await getScanById(db, allScans[currentIdx + 1].id);
        if (prevScan) {
          setComparison(compareScanResults(scanRecord.stocks, prevScan.stocks));
        }
      }
    })();
  }, [db, id]);

  const newSymbolSet = useMemo(
    () => new Set(comparison?.new_entries.map((s) => s.symbol) ?? []),
    [comparison]
  );
  const commonMap = useMemo(
    () => new Map(comparison?.common.map((c) => [c.symbol, c]) ?? []),
    [comparison]
  );

  const displayStocks = useMemo((): Stock[] => {
    if (!scan) return [];
    if (!comparison) return scan.stocks;

    switch (viewTab) {
      case "new":
        return comparison.new_entries;
      case "common":
        return comparison.common.map((c) => c.current);
      case "dropped":
        return comparison.dropped;
      default:
        return scan.stocks;
    }
  }, [scan, comparison, viewTab]);

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  if (!scan) {
    return (
      <View style={styles.container}>
        <StyledText
          variant="body"
          color={colors.secondary[500]}
          align="center"
          style={styles.loadingText}
        >
          Loading...
        </StyledText>
      </View>
    );
  }

  const renderStockItem = ({ item }: { item: Stock }) => {
    let badge = null;
    if (comparison && viewTab !== "dropped") {
      if (newSymbolSet.has(item.symbol)) {
        badge = <Badge label="NEW" variant="info" />;
      } else {
        const common = commonMap.get(item.symbol);
        if (common && common.rs_delta > 0) {
          badge = <Badge label={`RS +${common.rs_delta.toFixed(1)}`} variant="success" />;
        } else if (common && common.rs_delta < 0) {
          badge = <Badge label={`RS ${common.rs_delta.toFixed(1)}`} variant="danger" />;
        }
      }
    }
    if (viewTab === "dropped") {
      badge = <Badge label="DROPPED" variant="danger" />;
    }

    return (
      <StockCard
        stock={item}
        badge={badge}
        onPress={() =>
          router.push({
            pathname: "/stock/[symbol]",
            params: { symbol: item.symbol, data: JSON.stringify(item) },
          })
        }
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Header info */}
      <View style={styles.header}>
        <StyledText variant="bodyLarge" weight="semibold">
          {scan.count} stock{scan.count !== 1 ? "s" : ""}
        </StyledText>
        <StyledText variant="caption" color={colors.secondary[600]}>
          {formatDate(scan.scanned_at)}
        </StyledText>
      </View>

      {/* Comparison summary */}
      {comparison && (
        <View style={styles.summaryRow}>
          <Badge label={`${comparison.new_entries.length} new`} variant="info" />
          <Badge label={`${comparison.common.length} common`} variant="neutral" />
          <Badge label={`${comparison.dropped.length} dropped`} variant="danger" />
        </View>
      )}

      {/* View tabs */}
      {comparison && (
        <>
          <View style={styles.viewTabs}>
            {VIEW_TABS.map((tab) => {
              const isActive = viewTab === tab.key;
              const count =
                tab.key === "all"
                  ? scan.stocks.length
                  : tab.key === "new"
                    ? comparison.new_entries.length
                    : tab.key === "common"
                      ? comparison.common.length
                      : comparison.dropped.length;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.viewTab, isActive && styles.viewTabActive]}
                  onPress={() => setViewTab(tab.key)}
                >
                  <StyledText
                    variant="caption"
                    weight={isActive ? "bold" : "medium"}
                    color={isActive ? colors.accent_warm[300] : colors.secondary[600]}
                  >
                    {tab.label} ({count})
                  </StyledText>
                </Pressable>
              );
            })}
          </View>
          <Divider color={colors.primary[800]} marginVertical={0} />
        </>
      )}

      {!comparison && <Divider color={colors.primary[800]} marginVertical={0} />}

      {/* Stock list */}
      {displayStocks.length === 0 ? (
        <View style={styles.emptyState}>
          <StyledText variant="bodySmall" color={colors.secondary[600]}>
            No stocks in this view
          </StyledText>
        </View>
      ) : (
        <FlatList
          data={displayStocks}
          keyExtractor={(item) => item.symbol}
          renderItem={renderStockItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary[950],
  },
  loadingText: {
    marginTop: spacing["5xl"],
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  viewTabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  viewTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 6,
    backgroundColor: "transparent",
  },
  viewTabActive: {
    backgroundColor: colors.primary[700],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 40,
  },
});
