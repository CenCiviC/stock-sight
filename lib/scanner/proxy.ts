import { Platform } from "react-native";

/**
 * On web, route external API calls through the Metro dev server proxy
 * to avoid CORS restrictions. On native (iOS/Android), use direct URLs.
 */
const PROXY_MAP: Record<string, string> = {
  "https://query1.finance.yahoo.com/": "/proxy/yahoo/",
  "https://query2.finance.yahoo.com/": "/proxy/yahoo2/",
  "https://fc.yahoo.com/": "/proxy/yahoo-fc/",
  "https://api.nasdaq.com/": "/proxy/nasdaq/",
  "https://www.ishares.com/": "/proxy/ishares/",
  "https://en.wikipedia.org/": "/proxy/wikipedia/",
};

export function proxyUrl(url: string): string {
  if (Platform.OS !== "web") {
    return url;
  }

  for (const [origin, proxyPrefix] of Object.entries(PROXY_MAP)) {
    if (url.startsWith(origin)) {
      return url.replace(origin, proxyPrefix);
    }
  }

  return url;
}
