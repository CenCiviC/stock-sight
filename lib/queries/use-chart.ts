import { useQuery } from "@tanstack/react-query";

import { fetchChart } from "@/lib/scanner";
import type { ChartResult } from "@/lib/scanner";
import { queryKeys } from "./keys";

export function useChartQuery({
  symbol,
  days,
}: {
  symbol: string;
  days: number;
}) {
  return useQuery<ChartResult>({
    queryKey: queryKeys.chart(symbol, days),
    queryFn: () => fetchChart(symbol, days),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}
