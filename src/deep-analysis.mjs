import { analyzeHolders } from "./holder-analysis.mjs";
import { mergeMarketRow } from "./core.mjs";

function maxKnown(current, next) {
  if (!Number.isFinite(next)) return current;
  return Number.isFinite(current) ? Math.max(current, next) : next;
}

function applyPayload(candidate, payload) {
  if (payload?.info) mergeMarketRow(candidate, payload.info, "deep-info");
  if (payload?.security) mergeMarketRow(candidate, payload.security, "deep-security");
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
    concurrency = 3,
    cacheSeconds = 1800,
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

  await mapLimit(selectedKeys.slice(0, limit), concurrency, async (key) => {
    const candidate = byKey.get(key);
    const cached = store.getHolderCache(key, cacheSeconds);
    if (cached?.status === "verified"
      && cached.payload?.holderAnalysis?.analysisVersion === 4
      && cached.payload?.metadataVersion === 1) {
      applyPayload(candidate, cached.payload);
      return;
    }
    const cacheAge = cached ? Math.floor(Date.now() / 1000) - cached.checkedAt : Infinity;
    if (cached?.status === "failed" && cacheAge <= 120) {
      candidate.verificationStatus = "failed";
      candidate.deepAnalysisError = cached.error || "Top100 尽调失败";
      return;
    }

    try {
      const [holdersResult, securityResult, infoResult] = await Promise.allSettled([
        gmgnWithRetry(gmgn, ["token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--limit", "100", "--raw"]),
        gmgnWithRetry(gmgn, ["token", "security", "--chain", candidate.chain, "--address", candidate.address, "--raw"]),
        gmgnWithRetry(gmgn, ["token", "info", "--chain", candidate.chain, "--address", candidate.address, "--raw"])
      ]);
      if (holdersResult.status !== "fulfilled") throw holdersResult.reason;
      let smartPayload;
      let kolPayload;
      let devPayload;
      try {
        smartPayload = (await gmgnWithRetry(gmgn, ["token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--tag", "smart_degen", "--limit", "100", "--raw"])).data;
      } catch {
        notices.push(`${candidate.chain}/${candidate.symbol}: 当前聪明钱名单仅覆盖 Top100`);
      }
      try {
        kolPayload = (await gmgnWithRetry(gmgn, ["token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--tag", "renowned", "--limit", "100", "--raw"])).data;
      } catch {
        notices.push(`${candidate.chain}/${candidate.symbol}: 当前 KOL 名单仅覆盖 Top100`);
      }
      try {
        devPayload = (await gmgnWithRetry(gmgn, ["token", "holders", "--chain", candidate.chain, "--address", candidate.address, "--tag", "dev", "--limit", "20", "--raw"])).data;
      } catch {
        notices.push(`${candidate.chain}/${candidate.symbol}: 开发者名单仅覆盖 Top100`);
      }
      const holderAnalysis = analyzeHolders(holdersResult.value.data, { smartPayload, kolPayload, devPayload });
      const security = securityResult.status === "fulfilled" ? securityResult.value.data : null;
      const info = infoResult.status === "fulfilled" ? infoResult.value.data : null;
      const payload = { holderAnalysis, security, info, metadataVersion: 1 };
      applyPayload(candidate, payload);
      store.putHolderCache(key, "verified", payload);
      if (!security) candidate.deepAnalysisError = "合约安全数据暂时不可用";
      if (!info) notices.push(`${candidate.chain}/${candidate.symbol}: 叙事资料暂时不可用`);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      candidate.verificationStatus = "failed";
      candidate.deepAnalysisError = message;
      store.putHolderCache(key, "failed", null, message);
      notices.push(`${candidate.chain}/${candidate.symbol}: Top100 尽调失败`);
    }
  });

  return { selected: selectedKeys.slice(0, limit).length };
}
