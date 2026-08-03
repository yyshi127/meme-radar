import { cleanText } from "./core.mjs";

const VERSION = 1;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedSymbol(value) {
  return cleanText(value, "", 40).toUpperCase();
}

function normalizedChain(value) {
  const chain = cleanText(value, "", 24).toLowerCase();
  if (chain === "solana") return "sol";
  if (chain === "ethereum") return "eth";
  return chain;
}

function normalizedAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeUrl(value) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : null;
}

function normalizePair(pair) {
  const address = cleanText(pair?.baseToken?.address, "", 80);
  const marketCap = finite(pair?.marketCap);
  if (!address || marketCap === null || marketCap < 0) return null;
  return {
    chain: normalizedChain(pair?.chainId),
    address,
    symbol: cleanText(pair?.baseToken?.symbol, "?", 40),
    name: cleanText(pair?.baseToken?.name, "?", 80),
    marketCap,
    liquidity: finite(pair?.liquidity?.usd),
    priceUsd: finite(pair?.priceUsd),
    pairUrl: safeUrl(pair?.url)
  };
}

export function selectSameNameLeader(payload, symbol) {
  const querySymbol = normalizedSymbol(symbol);
  const uniqueTokens = new Map();
  for (const pair of Array.isArray(payload?.pairs) ? payload.pairs : []) {
    if (normalizedSymbol(pair?.baseToken?.symbol) !== querySymbol) continue;
    const token = normalizePair(pair);
    if (!token) continue;
    const key = `${token.chain}:${normalizedAddress(token.address)}`;
    const previous = uniqueTokens.get(key);
    if (!previous || (token.liquidity || 0) > (previous.liquidity || 0)) uniqueTokens.set(key, token);
  }
  const tokens = [...uniqueTokens.values()].sort((a, b) => b.marketCap - a.marketCap);
  return {
    version: VERSION,
    status: tokens.length ? "ready" : "empty",
    source: "dexscreener",
    matchRule: "exact_symbol",
    querySymbol,
    matchCount: tokens.length,
    leader: tokens[0] || null
  };
}

function applyResult(candidate, result) {
  const leader = result?.leader;
  const isCurrent = Boolean(
    leader
    && normalizedChain(leader.chain) === normalizedChain(candidate.chain)
    && normalizedAddress(leader.address) === normalizedAddress(candidate.address)
  );
  const marketCapMultiple = leader
    && Number.isFinite(leader.marketCap)
    && Number.isFinite(candidate.marketCap)
    && candidate.marketCap > 0
      ? leader.marketCap / candidate.marketCap
      : null;
  candidate.sameNameLeader = {
    ...result,
    isCurrent,
    marketCapMultiple
  };
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  async function run() {
    while (queue.length) await worker(queue.shift());
  }
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
}

async function searchDexScreener(symbol, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
      { headers: { accept: "application/json" }, signal: controller.signal }
    );
    if (!response.ok) throw new Error(`DexScreener search failed with HTTP ${response.status}`);
    return selectSameNameLeader(await response.json(), symbol);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(reason) {
  return {
    version: VERSION,
    status: "unavailable",
    source: "dexscreener",
    matchRule: "exact_symbol",
    reason,
    matchCount: 0,
    leader: null
  };
}

export async function enrichSameNameLeaders(candidates, selectedKeys, options) {
  const {
    store,
    fetcher = fetch,
    concurrency = 3,
    cacheSeconds = 300,
    failureCacheSeconds = 1800,
    notices = []
  } = options;
  const targets = candidates.filter((candidate) => selectedKeys.has(candidate.key));
  const groups = new Map();
  let ready = 0;
  let empty = 0;
  let failed = 0;
  let cached = 0;

  for (const candidate of targets) {
    const symbol = normalizedSymbol(candidate.symbol);
    if (!symbol || symbol === "?") {
      applyResult(candidate, unavailable("missing_symbol"));
      failed += 1;
      continue;
    }
    if (!groups.has(symbol)) groups.set(symbol, []);
    groups.get(symbol).push(candidate);
  }

  await mapLimit([...groups.entries()], concurrency, async ([symbol, group]) => {
    const key = `symbol:${symbol}`;
    const fresh = store.getSameNameCache(key, cacheSeconds);
    let result;
    if (fresh?.status === "ready" && fresh.payload?.version === VERSION) {
      result = fresh.payload;
      cached += group.length;
    } else {
      const recentFailure = store.getSameNameCache(key, failureCacheSeconds);
      if (recentFailure && recentFailure.status !== "ready") {
        result = unavailable(recentFailure.error || "temporarily_unavailable");
        cached += group.length;
      } else {
        try {
          result = await searchDexScreener(symbol, fetcher);
          store.putSameNameCache(key, "ready", result);
        } catch (error) {
          const message = String(error?.message || error).slice(0, 300);
          result = unavailable("search_failed");
          store.putSameNameCache(key, "failed", result, message);
          notices.push(`${symbol}: same-name market-cap search temporarily unavailable`);
        }
      }
    }

    for (const candidate of group) {
      applyResult(candidate, result);
      if (result.status === "ready") ready += 1;
      else if (result.status === "empty") empty += 1;
      else failed += 1;
    }
  });

  return { selected: targets.length, ready, empty, failed, cached };
}
