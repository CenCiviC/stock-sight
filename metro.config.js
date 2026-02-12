const { getDefaultConfig } = require("expo/metro-config");
const https = require("https");
const http = require("http");

const config = getDefaultConfig(__dirname);

// Proxy middleware to bypass CORS on web
const PROXY_ROUTES = {
  "/proxy/yahoo/": "https://query1.finance.yahoo.com/",
  "/proxy/yahoo2/": "https://query2.finance.yahoo.com/",
  "/proxy/yahoo-fc/": "https://fc.yahoo.com/",
  "/proxy/nasdaq/": "https://api.nasdaq.com/",
  "/proxy/ishares/": "https://www.ishares.com/",
  "/proxy/wikipedia/": "https://en.wikipedia.org/",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

// Server-side cookie jar for Yahoo domains (shared across all proxy requests)
let yahooCookieJar = "";

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      for (const [prefix, target] of Object.entries(PROXY_ROUTES)) {
        if (req.url.startsWith(prefix)) {
          const targetPath = req.url.slice(prefix.length);
          const targetUrl = target + targetPath;
          const parsedUrl = new URL(targetUrl);
          const transport = parsedUrl.protocol === "https:" ? https : http;
          const isYahoo = parsedUrl.hostname.endsWith("yahoo.com");

          const headers = {
            "User-Agent": USER_AGENT,
            Accept: "application/json,text/html,text/csv,*/*",
          };

          if (isYahoo && yahooCookieJar) {
            headers["Cookie"] = yahooCookieJar;
          }

          transport
            .get(
              targetUrl,
              { headers },
              (proxyRes) => {
                // Store cookies from Yahoo responses in the server-side jar
                if (isYahoo && proxyRes.headers["set-cookie"]) {
                  const setCookies = Array.isArray(proxyRes.headers["set-cookie"])
                    ? proxyRes.headers["set-cookie"]
                    : [proxyRes.headers["set-cookie"]];
                  const cookieMap = new Map();
                  if (yahooCookieJar) {
                    yahooCookieJar.split("; ").forEach((c) => {
                      const eq = c.indexOf("=");
                      if (eq > 0) cookieMap.set(c.slice(0, eq), c);
                    });
                  }
                  setCookies.forEach((c) => {
                    const val = c.split(";")[0];
                    const eq = val.indexOf("=");
                    if (eq > 0) cookieMap.set(val.slice(0, eq), val);
                  });
                  yahooCookieJar = Array.from(cookieMap.values()).join("; ");
                }

                res.writeHead(proxyRes.statusCode, {
                  "Content-Type":
                    proxyRes.headers["content-type"] || "application/octet-stream",
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Methods": "GET, OPTIONS",
                  "Access-Control-Allow-Headers": "Content-Type",
                });
                proxyRes.pipe(res);
              }
            )
            .on("error", (err) => {
              res.writeHead(502);
              res.end(JSON.stringify({ error: err.message }));
            });

          return;
        }
      }

      return middleware(req, res, next);
    };
  },
};

module.exports = config;
