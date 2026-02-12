import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { getScans, deleteScan, deleteAllScans } from "@/lib/db";
import type { ScanSummary } from "@/lib/db";
import type { IndexType } from "@/lib/scanner";
import { StyledText, Button, Badge, Card, Divider } from "@/components/ui";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

const FILTERS: { key: IndexType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "nasdaq", label: "NASDAQ" },
  { key: "russell_1000", label: "Russell" },
  { key: "sp500", label: "S&P 500" },
];

const INDEX_LABELS: Record<string, string> = {
  nasdaq: "NASDAQ",
  russell_1000: "Russell 1000",
  sp500: "S&P 500",
};

export default function HistoryList() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const [filter, setFilter] = useState<IndexType | "all">(
    (index as IndexType) ?? "all"
  );
  const [scans, setScans] = useState<ScanSummary[]>([]);

  const loadScans = useCallback(async () => {
    const data = await getScans(db, filter === "all" ? undefined : filter);
    setScans(data);
  }, [db, filter]);

  useFocusEffect(
    useCallback(() => {
      loadScans();
    }, [loadScans])
  );

  const handleDelete = (scanId: number) => {
    Alert.alert("Delete Scan", "Are you sure you want to delete this scan?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteScan(db, scanId);
          await loadScans();
        },
      },
    ]);
  };

  const handleDeleteAll = () => {
    Alert.alert(
      "Delete All Scans",
      "This will delete all scan history across all markets. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            await deleteAllScans(db);
            await loadScans();
          },
        },
      ]
    );
  };

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const renderScanItem = ({ item }: { item: ScanSummary }) => (
    <Card
      onPress={() =>
        router.push({
          pathname: "/history/[id]" as any,
          params: { id: String(item.id) },
        })
      }
      style={styles.scanCard}
    >
      <View style={styles.scanRow}>
        <View style={styles.scanInfo}>
          <View style={styles.scanTitleRow}>
            <Badge
              label={INDEX_LABELS[item.index_type] ?? item.index_type}
              variant="neutral"
            />
            <StyledText variant="data" color={colors.accent_warm[300]}>
              {item.count} stocks
            </StyledText>
          </View>
          <StyledText variant="caption" color={colors.secondary[600]}>
            {formatDate(item.scanned_at)}
          </StyledText>
        </View>
        <Pressable
          onPress={() => handleDelete(item.id)}
          hitSlop={8}
          style={styles.deleteBtn}
        >
          <StyledText variant="bodySmall" color={colors.negative}>
            Delete
          </StyledText>
        </Pressable>
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      {/* Filter chips */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <Pressable
              key={f.key}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <StyledText
                variant="caption"
                weight={isActive ? "bold" : "medium"}
                color={isActive ? colors.accent_warm[300] : colors.secondary[600]}
              >
                {f.label}
              </StyledText>
            </Pressable>
          );
        })}
      </View>

      {/* Delete All button */}
      {scans.length > 0 && (
        <View style={styles.deleteAllRow}>
          <Button
            title="Delete All"
            variant="ghost"
            size="sm"
            onPress={handleDeleteAll}
            style={styles.deleteAllBtn}
          />
        </View>
      )}

      <Divider color={colors.primary[800]} marginVertical={0} />

      {/* List */}
      {scans.length === 0 ? (
        <View style={styles.emptyState}>
          <StyledText variant="bodyLarge" color={colors.secondary[500]}>
            No scan history
          </StyledText>
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderScanItem}
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
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: "transparent",
  },
  filterChipActive: {
    backgroundColor: colors.primary[700],
  },
  deleteAllRow: {
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  deleteAllBtn: {
    // ghost button styled by component
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
  scanCard: {
    marginBottom: spacing.sm,
  },
  scanRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scanInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  scanTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  deleteBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
