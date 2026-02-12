import { useQuery } from "@tanstack/react-query";

import { fetchCompanyProfile } from "@/lib/scanner";
import type { CompanyProfile } from "@/lib/scanner";
import { queryKeys } from "./keys";

export function useCompanyProfileQuery({ symbol }: { symbol: string }) {
  return useQuery<CompanyProfile>({
    queryKey: queryKeys.companyProfile(symbol),
    queryFn: () => fetchCompanyProfile(symbol),
    enabled: !!symbol,
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days
    gcTime: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}
