import { colors } from "@/constants/colors";
import { borderRadius } from "@/constants/spacing";
import type { OHLCVBar } from "@/lib/scanner";
import { rollingSMA } from "@/lib/scanner";
import { useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

interface StockChartProps {
  bars: OHLCVBar[];
  height?: number;
  /** Compact mode: hides axes, grid, crosshair. For inline/card display. */
  compact?: boolean;
  /** Moving average periods to display (e.g. [50, 200]) */
  maPeriods?: number[];
}

const MA_COLORS: Record<number, string> = {
  10: "#e6e600",
  20: "#ff9800",
  50: "#2196f3",
  150: "#9c27b0",
  200: "#f44336",
};

function getMAColor(period: number): string {
  return MA_COLORS[period] ?? "#888888";
}

type MALineData = { period: number; color: string; data: { time: string; value: number }[] };

function computeMALines(bars: OHLCVBar[], periods: number[]): MALineData[] {
  const closes = bars.map((b) => b.close);
  const lines: MALineData[] = [];

  for (const period of periods) {
    const sma = rollingSMA(closes, period);
    const data: { time: string; value: number }[] = [];
    for (let i = 0; i < bars.length; i++) {
      const v = sma[i];
      if (v !== null) {
        data.push({ time: bars[i].date, value: v });
      }
    }
    if (data.length > 0) {
      lines.push({ period, color: getMAColor(period), data });
    }
  }

  return lines;
}

/**
 * Stock candlestick + volume chart using TradingView Lightweight Charts in a WebView.
 */
export function StockChart({
  bars,
  height = 320,
  compact = false,
  maPeriods = [],
}: StockChartProps) {
  const webViewRef = useRef<WebView>(null);

  const html = useMemo(() => {
    const candleData = bars.map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));

    const volumeData = bars.map((b) => ({
      time: b.date,
      value: b.volume,
      color:
        b.close >= b.open
          ? "rgba(74, 222, 128, 0.3)"
          : "rgba(248, 113, 113, 0.3)",
    }));

    const maLines = maPeriods.length > 0 ? computeMALines(bars, maPeriods) : [];

    return compact
      ? buildCompactChartHtml(candleData, volumeData, height, maLines)
      : buildChartHtml(candleData, volumeData, height, maLines);
  }, [bars, height, compact, maPeriods]);

  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, { height }]}>
        <iframe
          srcDoc={html}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: borderRadius.md,
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled={true}
        originWhitelist={["*"]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

type CandleItem = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};
type VolumeItem = { time: string; value: number; color: string };

function buildMAScript(maLines: MALineData[]): string {
  if (maLines.length === 0) return "";

  return maLines.map((line) => `
      var ma${line.period} = chart.addLineSeries({
        color: '${line.color}',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      ma${line.period}.setData(${JSON.stringify(line.data)});
  `).join("\n");
}

function buildChartHtml(
  candleData: CandleItem[],
  volumeData: VolumeItem[],
  height: number,
  maLines: MALineData[] = [],
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${colors.primary[900]};
      overflow: hidden;
      -webkit-user-select: none;
      user-select: none;
    }
    #chart {
      width: 100%;
      height: ${height}px;
    }
    #tv-attr-logo { display: none !important; }
  </style>
</head>
<body>
  <div id="chart"></div>
  <script>
    (function() {
      var chart = LightweightCharts.createChart(document.getElementById('chart'), {
        width: document.body.clientWidth,
        height: ${height},
        layout: {
          background: { type: 'solid', color: '${colors.primary[900]}' },
          textColor: '${colors.secondary[600]}',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: '${colors.primary[700]}' },
          horzLines: { color: '${colors.primary[700]}' },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: '${colors.secondary[600]}',
            width: 1,
            style: LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: '${colors.primary[600]}',
          },
          horzLine: {
            color: '${colors.secondary[600]}',
            width: 1,
            style: LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: '${colors.primary[600]}',
          },
        },
        rightPriceScale: {
          borderColor: '${colors.primary[700]}',
          scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        timeScale: {
          borderColor: '${colors.primary[700]}',
          timeVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        handleScroll: { vertTouchDrag: false },
      });

      var candleSeries = chart.addCandlestickSeries({
        upColor: '${colors.positive}',
        downColor: '${colors.negative}',
        borderUpColor: '${colors.positive}',
        borderDownColor: '${colors.negative}',
        wickUpColor: '${colors.positive}',
        wickDownColor: '${colors.negative}',
      });

      var volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      candleSeries.setData(${JSON.stringify(candleData)});
      volumeSeries.setData(${JSON.stringify(volumeData)});

      ${buildMAScript(maLines)}

      chart.timeScale().fitContent();

      window.addEventListener('resize', function() {
        chart.applyOptions({ width: document.body.clientWidth });
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * Compact chart: no axes, no grid, no crosshair, no volume labels.
 * Visually identical candlestick rendering, just minimal chrome.
 */
function buildCompactChartHtml(
  candleData: CandleItem[],
  volumeData: VolumeItem[],
  height: number,
  maLines: MALineData[] = [],
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${colors.primary[800]};
      overflow: hidden;
      -webkit-user-select: none;
      user-select: none;
    }
    #chart {
      width: 100%;
      height: ${height}px;
    }
    #tv-attr-logo { display: none !important; }
  </style>
</head>
<body>
  <div id="chart"></div>
  <script>
    (function() {
      var chart = LightweightCharts.createChart(document.getElementById('chart'), {
        width: document.body.clientWidth,
        height: ${height},
        layout: {
          background: { type: 'solid', color: '${colors.primary[800]}' },
          textColor: 'transparent',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: 0,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Hidden,
        },
        rightPriceScale: {
          visible: false,
          scaleMargins: { top: 0.05, bottom: 0.2 },
        },
        timeScale: {
          visible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        handleScroll: false,
        handleScale: false,
      });

      var candleSeries = chart.addCandlestickSeries({
        upColor: '${colors.positive}',
        downColor: '${colors.negative}',
        borderUpColor: '${colors.positive}',
        borderDownColor: '${colors.negative}',
        wickUpColor: '${colors.positive}',
        wickDownColor: '${colors.negative}',
      });

      var volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      candleSeries.setData(${JSON.stringify(candleData)});
      volumeSeries.setData(${JSON.stringify(volumeData)});

      ${buildMAScript(maLines)}

      chart.timeScale().fitContent();
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.md,
    overflow: "hidden",
    backgroundColor: colors.primary[900],
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
