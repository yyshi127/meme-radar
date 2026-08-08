import { analyzeHolders } from "./holder-analysis.mjs";
import { mergeMarketRow } from "./core.mjs";
import { isGmgnRateLimitError } from "./gmgn.mjs";

const RATE_LIMIT_CACHE_KEY = "__deep_analysis_rate_limit__";

function maxKnown(current, next) {
  if (!Number.isFinite(next)) return current;
  return Number.isFinite(current) ? Math.max(current, next) : next;
}

function applyPayload(candidate, payload) {
  const currentMarket = {
    price: candidate.price,
    marketCap: candidate.marketCap,
    liquidity: candidate.liquidity
  };
  if (payload?.info) mergeMarketRow(candidate, payload.info, "deep-info");
  if (payload?.security) mergeMarketRow(candidate, payload.security, "deep-security");
  for (const [field, value] of Object.entries(currentMarket)) {
    if (Number.isFinite(value)) candidate[field] = value;
  }
  if (payload?.holderAnalysis) {
    candidate.holderAnalysis = payload.holderAnalysis;
    candidate.verificationStatus = payload.holderAnalysis.status;
    candidate.top10Rate = maxKnown(candidate.top10Rate, payload.holderAnalysis.top10Rate);
    candidate.bundlerRate = maxKnown(candidate.bundlerRate, payload.holderAnalysis.bundlerRate);
    candidate.insiderRate = maxKnown(candidate.insiderRate, payload.holderAnalysis.insiderRate);
  }
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const results = [];
  async function run() {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function isTransient(error) {
  return /ConnectTimeout|Connect Timeout|ECONNRESET|fetch failed/i.test(String(error?.stderr || error?.stdout || error?.message || error));
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

export async function enrichDeepCandidates(candidates, initialScores, options) {
  const {
    gmgn,
    store,
    limit = 25,
    concurrency = 1,
    requestLimit = 3,
    cacheSeconds = 1800,
    failureCacheSeconds = 1800,
    rateLimitCooldownSeconds = 1800,
    watchedKeys = new Set(),
    notices = []
  } = options;

  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const selectedKeys = [];
  for (const key of watchedKeys) if (byKey.has(key)) selectedKeys.push(key);
  const ranked = [...initialScores].sort((a, b) => b.score - a.score);
  for (const scored of ranked.filter((item) => ["ALERT", "WATCH"].includes(item.priority))) {
    if (selectedKeys.length >= limit) break;
    if (!selectedKeys.includes(scored.key)) selectedKeys.push(scored.key);
  }
  for (const scored of ranked) {
    if (selectedKeys.length >= limit) break;
    if (scored.score < 50) continue;
    if (!selectedKeys.includes(scored.key)) selectedKeys.push(scored.key);
  }

  for (const candidate of candidates) candidate.verificationStatus = "pending";

  const limitedKeys = selectedKeys.slice(0, limit);
  const unresolved = [];
  let cachedCount = 0;
  let verified = 0;
  let failed = 0;
  let attempted = 0;
  let rateLimited = false;
  let retryAt = null;

  for (const key of limitedKeys) {
    const candidate = byKey.get(key);
    const cached = store.getHolderCache(key, Number.POSITIVE_INFINITY);
    const cacheAge = cached ? Math.floor(Date.now() / 1000) - cached.checkedAt : Infinity;
    const reusable = cached?.status === "verified"
      && cached.payload?.holderAnalysis?.analysisVersion === 4
      && cached.payload?.metadataVersion === 1;
    if (reusable) {
      applyPayload(candidate, cached.payload);
      cachedCount += 1;
      if (cacheAge <= cacheSeconds) {
        verified += 1;
        continue;
      }
    }
    if (cached?.status === "failed" && cacheAge <= failureCacheSeconds) {
      candidate.verificationStatus = "failed";
      candidate.deepAnalysisError = cached.error || "Top100 尽调失败";
      cachedCount += 1;
      failed += 1;
      continue;
    }
    unresolved.push({ key, hasReusableCache: reusable });
  }

  const rateLimitMarker = store.getHolderCache(RATE_LIMIT_CACHE_KEY, rateLimitCooldownSeconds);
  if (rateLimitMarker?.status === "rate_limited") {
    rateLimited = true;
    const localRetryAt = new Date((rateLimitMarker.checkedAt + rateLimitCooldownSeconds) * 1000).toISOString();
    retryAt = rateLimitMarker.error && Date.parse(rateLimitMarker.error) > Date.now()
      ? rateLimitMarker.error
      : localRetryAt;
  }

  // New candidates are more valuable than refreshing an already usable stale
  // cache. This also prevents the same top-ranked tokens from consuming every
  // request slot on every scan.
  unresolved.sort((a, b) => Number(a.hasReusableCache) - Number(b.hasReusableCache));
  const requestKeys = rateLimited
    ? []
    : unresolved.slice(0, Math.max(0, requestLimit)).map((item) => item.key);

  await mapLimit(requestKeys, concurrency, async (key) => {
    if (rateLimited) return;
    const candidate = byKey.get(key);
    attempted += 1;

    try {
      const holdersResult = await gmgnWithRetry(gmgn, [
        "token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--limit", "100", "--raw"
      ]);
      let security = null;
      let info = null;
      let devPayload;
      try {
        security = (await gmgnWithRetry(gmgn, [
          "token", "security", "--chain", candidate.chain, "--address", candidate.address, "--raw"
        ])).data;
      } catch (error) {
        if (isGmgnRateLimitError(error)) throw error;
      }
      try {
        info = (await gmgnWithRetry(gmgn, [
          "token", "info", "--chain", candidate.chain, "--address", candidate.address, "--raw"
        ])).data;
      } catch (error) {
        if (isGmgnRateLimitError(error)) throw error;
      }
      try {
        devPayload = (await gmgnWithRetry(gmgn, ["token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--tag", "dev", "--limit", "20", "--raw"])).data;
      } catch (error) {
        if (isGmgnRateLimitError(error)) throw error;
        notices.push(`${candidate.chain}/${candidate.symbol}: 开发者名单仅覆盖 Top100`);
      }
      // Smart-money and KOL tags are already included on the Top100 rows. The
      // dedicated tag queries add two more weight-5 calls per token, so the
      // radar uses the documented Top100 fallback and reserves the extra call
      // only for the developer wallet list.
      const holderAnalysis = analyzeHolders(holdersResult.data, { devPayload });
      const payload = { holderAnalysis, security, info, metadataVersion: 1 };
      applyPayload(candidate, payload);
      store.putHolderCache(key, "verified", payload);
      verified += 1;
      if (!security) candidate.deepAnalysisError = "合约安全数据暂时不可用";
      if (!info) notices.push(`${candidate.chain}/${candidate.symbol}: 叙事资料暂时不可用`);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      if (isGmgnRateLimitError(error)) {
        rateLimited = true;
        const upstreamRetryAt = Date.parse(error.retryAt || "");
        const localRetryAt = Date.now() + rateLimitCooldownSeconds * 1000;
        retryAt = new Date(Math.max(Number.isFinite(upstreamRetryAt) ? upstreamRetryAt : 0, localRetryAt)).toISOString();
        store.putHolderCache(RATE_LIMIT_CACHE_KEY, "rate_limited", null, retryAt);
        if (candidate.verificationStatus !== "verified") candidate.verificationStatus = "pending";
        candidate.deepAnalysisError = "GMGN 限流，等待后台补充深度数据";
        notices.push(`${candidate.chain}/${candidate.symbol}: 深度尽调触发限流，保留本轮行情并暂停后续深度请求`);
        return;
      }
      candidate.verificationStatus = "failed";
      candidate.deepAnalysisError = message;
      store.putHolderCache(key, "failed", null, message);
      failed += 1;
      notices.push(`${candidate.chain}/${candidate.symbol}: Top100 尽调失败`);
    }
  });

  const pending = limitedKeys.filter((key) => byKey.get(key)?.verificationStatus === "pending").length;
  return {
    selected: limitedKeys.length,
    selectedKeys: limitedKeys,
    attempted,
    verified,
    failed,
    cached: cachedCount,
    pending,
    rateLimited,
    retryAt
  };
}
