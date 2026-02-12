import { useQuery } from "@tanstack/react-query";

import { fetchFinancials } from "@/lib/scanner";
import type { QuarterlyFinancial } from "@/lib/scanner";
import { queryKeys } from "./keys";

export function useFinancialsQuery({ symbol }: { symbol: string }) {
  return useQuery<QuarterlyFinancial[]>({
    queryKey: queryKeys.financials(symbol),
    queryFn: () => fetchFinancials(symbol),
    enabled: !!symbol,
    staleTime: 24 * 60 * 60 * 1000, // 1 day
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}
