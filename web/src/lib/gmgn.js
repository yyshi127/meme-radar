const SUPPORTED_CHAINS = new Set(["sol", "bsc"]);

export function gmgnTokenUrl(chain, address) {
  const normalizedChain = String(chain || "").toLowerCase();
  if (!SUPPORTED_CHAINS.has(normalizedChain) || !address) return null;
  return `https://gmgn.ai/${normalizedChain}/token/${encodeURIComponent(address)}`;
}

export function gmgnAppIntentUrl(chain, address) {
  const webUrl = gmgnTokenUrl(chain, address);
  if (!webUrl) return null;
  const intentPath = webUrl.slice("https://".length);
  return `intent://${intentPath}#Intent;scheme=https;package=com.gmgn.app;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
}
