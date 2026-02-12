import { StyleSheet, View } from "react-native";
import type { QuarterlyFinancial } from "@/lib/scanner";
import { StyledText } from "./text";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

interface FinancialsChartProps {
  data: QuarterlyFinancial[];
}

/** Abbreviate a number: 1.2B, 350M, 12K, etc. */
function formatAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(0) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + "K";
  return sign + abs.toFixed(0);
}

/** Shorten quarter label: "2024-Q3" → "Q3 '24" */
function shortLabel(date: string): string {
  const match = date.match(/^(\d{4})-Q(\d)$/);
  if (!match) return date;
  return `Q${match[2]} '${match[1].slice(2)}`;
}

const BAR_HEIGHT = 150;
const BAR_W = 18;
const NET_BAR_W = 12;
const BAR_GAP = 3;

export function FinancialsChart({ data }: FinancialsChartProps) {
  if (data.length === 0) return null;

  const allValues = data.flatMap((d) => [d.revenue, d.netIncome]);
  const maxVal = Math.max(...allValues, 0);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  // Distance from top of bar area to the zero line
  const zeroY = (maxVal / range) * BAR_HEIGHT;

  return (
    <View style={styles.container}>
      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent_warm[300] }]} />
          <StyledText variant="caption" color={colors.secondary[500]}>
            Revenue
          </StyledText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.info }]} />
          <StyledText variant="caption" color={colors.secondary[500]}>
            Net Income
          </StyledText>
        </View>
      </View>

      {/* Revenue amount labels — own row */}
      <View style={styles.labelsRow}>
        {data.map((q, i) => (
          <View key={i} style={styles.labelCell}>
            <StyledText variant="caption" color={colors.secondary[500]} style={styles.amountText}>
              {formatAmount(q.revenue)}
            </StyledText>
          </View>
        ))}
      </View>

      {/* Bar area — fixed height, bars only */}
      <View style={[styles.barsArea, { height: BAR_HEIGHT }]}>
        <View style={[styles.zeroLine, { top: zeroY }]} />

        {data.map((q, i) => {
          const revH = (Math.abs(q.revenue) / range) * BAR_HEIGHT;
          const netH = (Math.abs(q.netIncome) / range) * BAR_HEIGHT;
          const revTop = q.revenue >= 0 ? zeroY - revH : zeroY;
          const netTop = q.netIncome >= 0 ? zeroY - netH : zeroY;
          const netColor = q.netIncome >= 0 ? colors.info : colors.negative;

          return (
            <View key={i} style={styles.barCell}>
              <View style={styles.barPairInner}>
                <View
                  style={[
                    styles.revBar,
                    { height: Math.max(revH, 2), top: revTop },
                  ]}
                />
                <View
                  style={[
                    styles.netBar,
                    {
                      height: Math.max(netH, 2),
                      top: netTop,
                      backgroundColor: netColor,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Net income amount labels — own row */}
      <View style={styles.labelsRow}>
        {data.map((q, i) => {
          const netColor = q.netIncome >= 0 ? colors.info : colors.negative;
          return (
            <View key={i} style={styles.labelCell}>
              <StyledText variant="caption" color={netColor} style={styles.amountText}>
                {formatAmount(q.netIncome)}
              </StyledText>
            </View>
          );
        })}
      </View>

      {/* Quarter labels — own row */}
      <View style={styles.labelsRow}>
        {data.map((q, i) => (
          <View key={i} style={styles.labelCell}>
            <StyledText variant="caption" color={colors.secondary[500]}>
              {shortLabel(q.date)}
            </StyledText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  legend: {
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  labelsRow: {
    flexDirection: "row",
  },
  labelCell: {
    flex: 1,
    alignItems: "center",
  },
  amountText: {
    fontSize: 10,
  },
  barsArea: {
    flexDirection: "row",
    position: "relative",
    overflow: "hidden",
  },
  zeroLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.secondary[700],
  },
  barCell: {
    flex: 1,
    alignItems: "center",
  },
  barPairInner: {
    width: BAR_W + BAR_GAP + NET_BAR_W,
    height: BAR_HEIGHT,
    position: "relative",
  },
  revBar: {
    position: "absolute",
    left: 0,
    width: BAR_W,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accent_warm[300],
  },
  netBar: {
    position: "absolute",
    left: BAR_W + BAR_GAP,
    width: NET_BAR_W,
    borderRadius: borderRadius.sm,
  },
});
