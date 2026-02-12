export const queryKeys = {
  chart: (symbol: string, days: number) => ["chart", symbol, days] as const,
  financials: (symbol: string) => ["financials", symbol] as const,
  companyProfile: (symbol: string) => ["companyProfile", symbol] as const,
};
