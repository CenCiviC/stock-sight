import { StyleSheet, View } from "react-native";
import type { SectorCount } from "@/lib/scanner";
import { Card } from "./card";
import { StyledText } from "./text";
import { colors } from "@/constants/colors";
import { spacing, borderRadius } from "@/constants/spacing";

// Named sector colors — covers GICS sectors + common Yahoo Finance variants
const SECTOR_COLORS: Record<string, string> = {
  "Information Technology": "#60A5FA",
  Technology: "#60A5FA",
  "Health Care": "#4ADE80",
  Healthcare: "#4ADE80",
  "Consumer Discretionary": "#F59E0B",
  "Consumer Cyclical": "#F59E0B",
  "Consumer Staples": "#A78BFA",
  "Consumer Defensive": "#A78BFA",
  Financials: "#F87171",
  "Financial Services": "#F87171",
  "Communication Services": "#38BDF8",
  Industrials: "#FB923C",
  Energy: "#EF4444",
  Materials: "#34D399",
  "Basic Materials": "#34D399",
  Utilities: "#818CF8",
  "Real Estate": "#E879F9",
};

// Fallback palette for sectors not in the map above
const FALLBACK_COLORS = [
  "#F472B6", // pink
  "#2DD4BF", // teal
  "#FACC15", // yellow
  "#C084FC", // purple
  "#22D3EE", // cyan
];

let fallbackIdx = 0;
const dynamicMap = new Map<string, string>();

function getSectorColor(sector: string): string {
  if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
  if (dynamicMap.has(sector)) return dynamicMap.get(sector)!;
  const color = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
  fallbackIdx++;
  dynamicMap.set(sector, color);
  return color;
}

interface SectorChartProps {
  sectors: SectorCount[];
  prevSectors?: SectorCount[];
  total: number;
}

export function SectorChart({ sectors, prevSectors, total }: SectorChartProps) {
  if (sectors.length === 0) return null;

  const prevMap = new Map<string, number>();
  if (prevSectors) {
    for (const s of prevSectors) {
      prevMap.set(s.sector, s.count);
    }
  }

  return (
    <Card style={styles.container}>
      <StyledText
        variant="bodySmall"
        weight="semibold"
        color={colors.secondary[400]}
        style={styles.title}
      >
        Sector Distribution
      </StyledText>

      {/* Stacked bar */}
      <View style={styles.barContainer}>
        {sectors.map((s) => {
          const pct = (s.count / total) * 100;
          if (pct < 1) return null;
          return (
            <View
              key={s.sector}
              style={[
                styles.barSegment,
                {
                  flex: s.count,
                  backgroundColor: getSectorColor(s.sector),
                },
              ]}
            />
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {sectors.map((s) => {
          const prev = prevMap.get(s.sector);
          const delta = prev != null ? s.count - prev : null;

          return (
            <View key={s.sector} style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: getSectorColor(s.sector) },
                ]}
              />
              <StyledText variant="caption" color={colors.secondary[400]}>
                {s.sector}{" "}
              </StyledText>
              <StyledText variant="caption" color={colors.accent_light[400]} weight="semibold">
                {s.count}
              </StyledText>
              {delta != null && delta !== 0 && (
                <StyledText
                  variant="caption"
                  color={delta > 0 ? colors.positive : colors.negative}
                  weight="semibold"
                >
                  {delta > 0 ? `+${delta}` : `${delta}`}
                </StyledText>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  title: {
    marginBottom: spacing.md,
  },
  barContainer: {
    flexDirection: "row",
    height: 8,
    borderRadius: borderRadius.full,
    overflow: "hidden",
    gap: 1,
    marginBottom: spacing.md,
  },
  barSegment: {
    height: 8,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
