const SUPPORTED_CHAINS = new Set(["sol", "bsc"]);

export function gmgnTokenUrl(chain, address) {
  const normalizedChain = String(chain || "").toLowerCase();
  if (!SUPPORTED_CHAINS.has(normalizedChain) || !address) return null;
  return `https://gmgn.ai/${normalizedChain}/token/${encodeURIComponent(address)}`;
}
