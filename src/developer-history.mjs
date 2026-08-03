import { cleanText, isValidAddress, mergeMarketRow } from "./core.mjs";

const HISTORY_VERSION = 1;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = finite(value);
  return parsed === null ? 0 : Math.max(0, Math.floor(parsed));
}

function normalizedAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCreatedToken(row) {
  const address = normalizedAddress(row?.token_address);
  if (!address) return null;
  return {
    address,
    symbol: cleanText(row?.symbol, "?", 40),
    chain: cleanText(row?.chain, "", 12).toLowerCase(),
    createdAt: finite(row?.create_timestamp),
    migrated: row?.is_open === true,
    athMarketCap: finite(row?.token_ath_mc),
    marketCap: finite(row?.market_cap),
    liquidity: finite(row?.pool_liquidity),
    holders: finite(row?.holders),
    cto: row?.cto_flag === true
  };
}

export function normalizeDeveloperProfile(payload, chain, creatorAddress) {
  const root = payload?.data && !Array.isArray(payload?.tokens) ? payload.data : payload;
  const unique = new Map();
  for (const row of Array.isArray(root?.tokens) ? root.tokens : []) {
    const token = normalizeCreatedToken(row);
    if (token && !unique.has(token.address)) unique.set(token.address, token);
  }
  const tokens = [...unique.values()];
  const reportedTotal = nonNegativeInteger(root?.inner_count) + nonNegativeInteger(root?.open_count);

  // GMGN can return more concrete token rows than its aggregate count. Never
  // display a cumulative count lower than the unique records already returned.
  const totalCreatedCount = Math.max(reportedTotal, tokens.length);
  return {
    version: HISTORY_VERSION,
    chain,
    creatorAddress: normalizedAddress(creatorAddress),
    totalCreatedCount,
    countIsMinimum: tokens.length > reportedTotal,
    lastCreatedAt: finite(root?.last_create_timestamp),
    tokens
  };
}

export function projectDeveloperHistory(profile, currentTokenAddress) {
  const current = normalizedAddress(currentTokenAddress);
  const topTokens = (Array.isArray(profile?.tokens) ? profile.tokens : [])
    .filter((token) => token.address !== current)
    .sort((a, b) => (b.athMarketCap || 0) - (a.athMarketCap || 0))
    .slice(0, 3);
  return {
    version: HISTORY_VERSION,
    status: "ready",
    creatorAddress: profile.creatorAddress,
    totalCreatedCount: profile.totalCreatedCount,
    countIsMinimum: Boolean(profile.countIsMinimum),
    topTokens
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

function isTransient(error) {
  return /ConnectTimeout|Connect Timeout|ECONNRESET|fetch failed/i.test(
    String(error?.stderr || error?.stdout || error?.message || error)
  );
}

async function gmgnWithRetry(gmgn, args) {
  try {
    return await gmgn(args);
  } catch (error) {
    if (!isTransient(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return gmgn(args);
  }
}

function tokenCacheKey(candidate) {
  return `token:${candidate.key}`;
}

function creatorCacheKey(chain, creatorAddress) {
  return `creator:${chain}:${normalizedAddress(creatorAddress)}`;
}

function unavailable(reason) {
  return {
    version: HISTORY_VERSION,
    status: "unavailable",
    reason,
    totalCreatedCount: null,
    topTokens: []
  };
}

export async function enrichDeveloperHistories(candidates, selectedKeys, options) {
  const {
    gmgn,
    store,
    concurrency = 3,
    cacheSeconds = 6 * 3600,
    failureCacheSeconds = 30 * 60,
    notices = []
  } = options;
  const targets = candidates.filter((candidate) => selectedKeys.has(candidate.key));
  const unresolved = [];
  let cachedCount = 0;
  let ready = 0;
  let failed = 0;

  for (const candidate of targets) {
    const cached = store.getDeveloperHistoryCache(tokenCacheKey(candidate), cacheSeconds);
    if (cached?.status === "ready" && cached.payload?.history?.version === HISTORY_VERSION) {
      candidate.developerHistory = cached.payload.history;
      candidate.creatorAddress = cached.payload.history.creatorAddress || candidate.creatorAddress;
      cachedCount += 1;
      ready += 1;
      continue;
    }
    if (
      cached
      && cached.status !== "ready"
      && Math.floor(Date.now() / 1000) - cached.checkedAt <= failureCacheSeconds
    ) {
      candidate.developerHistory = cached.payload?.history || unavailable(cached.error || "temporarily_unavailable");
      cachedCount += 1;
      failed += 1;
      continue;
    }
    unresolved.push(candidate);
  }

  await mapLimit(
    unresolved.filter((candidate) => !isValidAddress(candidate.chain, candidate.creatorAddress)),
    concurrency,
    async (candidate) => {
      try {
        const infoResult = await gmgnWithRetry(gmgn, [
          "token", "info", "--chain", candidate.chain, "--address", candidate.address, "--raw"
        ]);
        notices.push(...(infoResult.notices || []).map((notice) => `${candidate.chain}/${candidate.symbol}: ${notice}`));
        mergeMarketRow(candidate, infoResult.data, "developer-info");
      } catch {
        notices.push(`${candidate.chain}/${candidate.symbol}: developer address temporarily unavailable`);
      }
    }
  );

  const groups = new Map();
  for (const candidate of unresolved) {
    if (!isValidAddress(candidate.chain, candidate.creatorAddress)) {
      const history = unavailable("missing_creator");
      candidate.developerHistory = history;
      store.putDeveloperHistoryCache(tokenCacheKey(candidate), "unavailable", { history }, "missing_creator");
      failed += 1;
      continue;
    }
    const key = creatorCacheKey(candidate.chain, candidate.creatorAddress);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }

  await mapLimit([...groups.entries()], concurrency, async ([key, group]) => {
    const first = group[0];
    let profile;
    const cached = store.getDeveloperHistoryCache(key, cacheSeconds);
    if (cached?.status === "ready" && cached.payload?.profile?.version === HISTORY_VERSION) {
      profile = cached.payload.profile;
      cachedCount += group.length;
    } else if (
      cached
      && cached.status !== "ready"
      && Math.floor(Date.now() / 1000) - cached.checkedAt <= failureCacheSeconds
    ) {
      for (const candidate of group) {
        const history = unavailable(cached.error || "temporarily_unavailable");
        candidate.developerHistory = history;
        store.putDeveloperHistoryCache(tokenCacheKey(candidate), "unavailable", { history }, cached.error);
        failed += 1;
      }
      return;
    } else {
      try {
        const result = await gmgnWithRetry(gmgn, [
          "portfolio", "created-tokens",
          "--chain", first.chain,
          "--wallet", first.creatorAddress,
          "--order-by", "token_ath_mc",
          "--direction", "desc",
          "--raw"
        ]);
        notices.push(...(result.notices || []).map((notice) => `${first.chain}/${first.symbol}: ${notice}`));
        profile = normalizeDeveloperProfile(result.data, first.chain, first.creatorAddress);
        store.putDeveloperHistoryCache(key, "ready", { profile });
      } catch (error) {
        const message = String(error?.message || error).slice(0, 300);
        store.putDeveloperHistoryCache(key, "failed", null, message);
        for (const candidate of group) {
          const history = unavailable("history_query_failed");
          candidate.developerHistory = history;
          store.putDeveloperHistoryCache(tokenCacheKey(candidate), "failed", { history }, message);
          failed += 1;
        }
        notices.push(`${first.chain}/${first.symbol}: developer token history temporarily unavailable`);
        return;
      }
    }

    for (const candidate of group) {
      const history = projectDeveloperHistory(profile, candidate.address);
      candidate.developerHistory = history;
      store.putDeveloperHistoryCache(tokenCacheKey(candidate), "ready", { history });
      ready += 1;
    }
  });

  return { selected: targets.length, ready, failed, cached: cachedCount };
}
