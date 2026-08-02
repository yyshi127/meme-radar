import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkConfig, gmgn } from "./gmgn.mjs";
import { enrichDeepCandidates } from "./deep-analysis.mjs";
import { enrichLifetimeTrends } from "./lifetime-trend.mjs";
import { radarStore } from "./store.mjs";
import { refreshWatchMarkets } from "./watch-market.mjs";
import {
  cleanText,
  escapeMarkdown,
  getCandidate,
  isValidAddress,
  mergeMarketRow,
  mergeSignal,
  mergeTrade,
  scoreCandidate,
  scoreCandidateEarly,
  scoreCandidateLegacy
} from "./core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "config.json");
const dataDir = path.join(root, "data");
const outputDir = path.join(root, "output");
const statePath = path.join(dataDir, "state.json");

async function jsonFile(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function safeFeed(label, args, errors, notices) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await gmgn(args);
      notices.push(...result.notices.map((notice) => `${label}: ${notice}`));
      return result.data;
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || "unknown error");
      const transient = /ConnectTimeout|Connect Timeout|ECONNRESET|fetch failed/i.test(detail) && !/429|RATE_LIMIT/i.test(detail);
      if (attempt === 0 && transient) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      errors.push(`${label}: ${cleanText(detail, "unknown error", 400)}`);
      return null;
    }
  }
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

async function sampleTrackedOutcomes(now, currentKeys, config, notices) {
  const due = radarStore.dueTrackedTokens(now, currentKeys, config.outcomeSampleLimit ?? 6);
  for (const tracked of due) {
    try {
      const info = await gmgn(["token", "info", "--chain", tracked.chain, "--address", tracked.address, "--raw"]);
      const book = new Map();
      const candidate = getCandidate(book, tracked.chain, tracked.address);
      mergeMarketRow(candidate, info.data, "outcome-sample");
      radarStore.recordExternalObservation({
        chain: tracked.chain,
        address: tracked.address,
        price: candidate.price,
        marketCap: candidate.marketCap,
        liquidity: candidate.liquidity
      }, now);
    } catch {
      notices.push(`${tracked.chain}/${tracked.address.slice(0, 8)}: 历史结果采样暂时失败`);
    }
  }
  return due.length;
}

async function collectChain(book, chain, config, errors, notices) {
  const cutoff = Math.floor(Date.now() / 1000) - config.clusterWindowMinutes * 60;
  const trending = await safeFeed(`${chain}/trending`, ["market", "trending", "--chain", chain, "--interval", "1m", "--limit", "80", "--raw"], errors, notices);
  for (const row of rows(trending?.data?.rank)) {
    const candidate = getCandidate(book, chain, row.address);
    mergeMarketRow(candidate, row, "trending");
  }

  const hot = await safeFeed(`${chain}/hot-search`, ["market", "hot-searches", "--chain", chain, "--interval", "1m", "--limit", "80", "--raw"], errors, notices);
  for (const block of rows(hot)) {
    for (const row of rows(block.tokens)) {
      const candidate = getCandidate(book, chain, row.address);
      mergeMarketRow(candidate, row, "hot-search");
    }
  }

  const trenches = await safeFeed(`${chain}/trenches`, ["market", "trenches", "--chain", chain, "--type", "new_creation", "--type", "near_completion", "--filter-preset", "safe", "--limit", "80", "--raw"], errors, notices);
  for (const row of rows(trenches?.new_creation || trenches?.data?.new_creation)) {
    const candidate = getCandidate(book, chain, row.address);
    mergeMarketRow(candidate, row, "new-creation", "new-creation");
  }
  for (const row of rows(trenches?.pump || trenches?.data?.pump)) {
    const candidate = getCandidate(book, chain, row.address);
    mergeMarketRow(candidate, row, "near-completion", "near-completion");
  }

  for (const type of [12, 20]) {
    const signal = await safeFeed(`${chain}/signal-${type}`, ["market", "signal", "--chain", chain, "--signal-type", String(type), "--raw"], errors, notices);
    for (const event of rows(signal)) {
      if (Number(event.trigger_at || 0) < cutoff) continue;
      const candidate = getCandidate(book, chain, event.token_address);
      mergeSignal(candidate, event);
    }
  }

  for (const [kind, subcommand] of [["smart", "smartmoney"], ["kol", "kol"]]) {
    const trades = await safeFeed(`${chain}/${subcommand}`, ["track", subcommand, "--chain", chain, "--side", "buy", "--limit", "100", "--raw"], errors, notices);
    for (const trade of rows(trades?.list)) {
      if (Number(trade.timestamp || 0) < cutoff || trade.side !== "buy") continue;
      const candidate = getCandidate(book, chain, trade.base_address);
      mergeTrade(candidate, trade, kind);
    }
  }
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function markdown(result, top) {
  const visible = result.candidates.filter((item) => item.priority !== "SKIP").slice(0, top);
  const rejected = result.candidates.filter((item) => item.priority === "SKIP").slice(0, 10);
  const lines = [
    "# Meme Radar — 最新扫描",
    "",
    `扫描时间：${result.generatedAt}`,
    "",
    "> 分数是研究优先级，不是上涨概率，也不是买入建议。ALERT 必须至少有两类信号共振。",
    "",
    "| 优先级 | 分数 | 阶段 | 链 | 代币 | 市值 | 流动性 | 聪明钱买家 | KOL 买家 | 信号 | 风险 |",
    "|---|---:|---|---|---|---:|---:|---:|---:|---|---|"
  ];
  for (const item of visible) {
    lines.push(`| ${item.priority} | ${item.score} | ${item.phase} | ${item.chain} | ${escapeMarkdown(item.symbol)} | ${money(item.marketCap)} | ${money(item.liquidity)} | ${item.smartMakers.length} | ${item.kolMakers.length} | ${escapeMarkdown(item.reasons.slice(0, 3).join("；"))} | ${escapeMarkdown(item.risks.slice(0, 2).join("；") || "-")} |`);
  }
  lines.push("", "## 本轮新报警", "");
  if (!result.alerts.length) lines.push("没有新的多源共振报警。");
  for (const item of result.alerts) {
    lines.push(`- **${escapeMarkdown(item.symbol)}** (${item.chain})：${item.score} 分；${escapeMarkdown(item.reasons.join("；"))}；合约：\`${item.address}\``);
  }
  lines.push("", "## 硬过滤", "");
  if (!rejected.length) lines.push("本轮没有进入 Top 列表的硬过滤项。");
  for (const item of rejected) lines.push(`- ${escapeMarkdown(item.symbol)} (${item.chain})：${escapeMarkdown(item.hardStops.join("；"))}`);
  if (result.errors.length) {
    lines.push("", "## 数据源错误", "");
    for (const error of result.errors) lines.push(`- ${escapeMarkdown(error)}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function scan(config, options = {}) {
  await checkConfig();
  const book = new Map();
  const errors = [];
  const notices = [];
  for (const chain of config.chains) await collectChain(book, chain, config, errors, notices);
  const watchMarketsRefreshed = await refreshWatchMarkets(book, { gmgn, store: radarStore, notices });

  const now = Math.floor(Date.now() / 1000);
  const sourceCandidates = [...book.values()];
  const calibrationBefore = radarStore.calibrationContext(config.calibrationMinSamples ?? 50);
  for (const candidate of sourceCandidates) {
    candidate.walletReputationBonus = radarStore.walletReputation(candidate, calibrationBefore).bonus;
  }
  const initialScores = sourceCandidates.map((candidate) => scoreCandidateEarly(candidate, {
    now,
    ...config
  }));
  const watchedKeys = radarStore.watchedKeys();
  const deepAnalysis = await enrichDeepCandidates(sourceCandidates, initialScores, {
    gmgn,
    store: radarStore,
    limit: config.deepAnalysisLimit ?? 25,
    concurrency: config.deepAnalysisConcurrency ?? 3,
    cacheSeconds: config.holderCacheSeconds ?? 1800,
    watchedKeys,
    notices
  });
  const trendAnalysis = await enrichLifetimeTrends(sourceCandidates, deepAnalysis.selectedKeys, {
    gmgn,
    store: radarStore,
    now,
    concurrency: config.klineConcurrency ?? 3,
    cacheSeconds: config.klineCacheSeconds ?? 240,
    notices
  });

  const oldState = await jsonFile(statePath, { candidates: {}, discoveryCandidates: {} });
  const nextState = { candidates: {}, discoveryCandidates: {} };
  const alerts = [];
  const deepByKey = new Map(sourceCandidates.map((candidate) => [candidate.key, candidate]));
  let discoveryCandidates = sourceCandidates
    .map((sourceCandidate) => scoreCandidateEarly(sourceCandidate, { now, ...config }))
    .map((candidate) => {
      const previous = oldState.discoveryCandidates?.[candidate.key] || oldState.candidates?.[candidate.key] || {};
      const firstSeen = previous.firstSeen || now;
      const scoreDelta = candidate.score - (previous.score ?? candidate.score);
      const deep = deepByKey.get(candidate.key);
      const enriched = {
        ...candidate,
        holderAnalysis: deep?.holderAnalysis,
        verificationStatus: deep?.verificationStatus || "pending",
        deepAnalysisError: deep?.deepAnalysisError,
        firstSeen,
        lastSeen: now,
        scoreDelta,
        isNewAlert: false
      };
      nextState.discoveryCandidates[candidate.key] = { firstSeen, lastSeen: now, score: enriched.score, priority: enriched.priority };
      return enriched;
    })
    .sort((a, b) => (b.priority === "ALERT") - (a.priority === "ALERT") || b.score - a.score || b.evidenceFamilyCount - a.evidenceFamilyCount);
  let candidates = sourceCandidates
    .map((candidate) => scoreCandidate(candidate, { now, ...config, strategy: "safety", requireVerification: true }))
    .map((candidate) => {
      const previous = oldState.candidates[candidate.key] || {};
      const firstSeen = previous.firstSeen || now;
      const scoreDelta = candidate.score - (previous.score ?? candidate.score);
      const shouldAlert = candidate.priority === "ALERT" && (!previous.alertedAt || now - previous.alertedAt > 6 * 3600) && (previous.priority !== "ALERT" || scoreDelta >= 12);
      const alertedAt = shouldAlert ? now : previous.alertedAt;
      const enriched = { ...candidate, firstSeen, lastSeen: now, scoreDelta, isNewAlert: shouldAlert };
      nextState.candidates[candidate.key] = { firstSeen, lastSeen: now, score: candidate.score, priority: candidate.priority, alertedAt };
      if (shouldAlert) alerts.push(enriched);
      return enriched;
    })
    .sort((a, b) => (b.priority === "ALERT") - (a.priority === "ALERT") || b.score - a.score || b.evidenceFamilyCount - a.evidenceFamilyCount);

  const trackingCandidates = new Map();
  for (const candidate of discoveryCandidates) {
    if (["ALERT", "WATCH"].includes(candidate.priority)) trackingCandidates.set(candidate.key, candidate);
  }
  for (const candidate of candidates) {
    if (["ALERT", "WATCH"].includes(candidate.priority) || (watchedKeys.has(candidate.key) && !trackingCandidates.has(candidate.key))) {
      trackingCandidates.set(candidate.key, candidate);
    }
  }
  radarStore.recordCandidates([...trackingCandidates.values()], now);
  radarStore.syncWatchSnapshots([...discoveryCandidates, ...candidates], now);
  const outcomeSamples = await sampleTrackedOutcomes(now, new Set(candidates.map((candidate) => candidate.key)), config, notices);
  const calibration = radarStore.calibrationContext(config.calibrationMinSamples ?? 50);
  candidates = radarStore.decorateCandidates(candidates, calibration);
  discoveryCandidates = radarStore.decorateCandidates(discoveryCandidates, calibration);
  const decoratedByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const decoratedAlerts = alerts.map((alert) => decoratedByKey.get(alert.key) || alert);

  const result = {
    generatedAt: new Date().toISOString(),
    chains: config.chains,
    candidates,
    discoveryCandidates,
    alerts: decoratedAlerts,
    errors,
    notices,
    deepAnalysis: { selected: deepAnalysis.selected, lifetimeTrends: trendAnalysis, outcomeSamples, watchMarketsRefreshed },
    calibration: calibration.report,
    strategies: {
      discovery: { name: "猎星榜", version: "early-v3", description: "原版评分加持币地址 >300、市值 $10k–$2M，并对已检测 Rug 风险一票否决；安全数据未完成时仅观察" },
      safety: { name: "验金榜", description: "通过 Top100、关联钱包和合约安全进行严格确认" }
    }
  };
  await mkdir(dataDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(nextState, null, 2));
  await writeFile(path.join(outputDir, "latest.json"), JSON.stringify(result, null, 2));
  await writeFile(path.join(outputDir, "latest.md"), markdown(result, config.top));

  if (!options.quiet) {
    const visible = candidates.filter((item) => item.priority !== "SKIP").slice(0, config.top);
    console.table(visible.map((item) => ({
      priority: item.priority,
      score: item.score,
      phase: item.phase,
      chain: item.chain,
      symbol: item.symbol,
      mcap: money(item.marketCap),
      liquidity: money(item.liquidity),
      smart: item.smartMakers.length,
      kol: item.kolMakers.length,
      families: item.evidenceFamilyCount
    })));
    console.log(`扫描完成：${candidates.length} 个候选，${alerts.length} 个新报警，${errors.length} 个数据源错误。`);
    console.log(`报告：${path.join(outputDir, "latest.md")}`);
  }
  return result;
}

export async function inspect(chain, address, config) {
  if (!config.chains.includes(chain) || !isValidAddress(chain, address)) throw new Error("链或合约地址格式不正确");
  await checkConfig();
  const [info, security] = await Promise.all([
    gmgn(["token", "info", "--chain", chain, "--address", address, "--raw"]),
    gmgn(["token", "security", "--chain", chain, "--address", address, "--raw"])
  ]);
  const book = new Map();
  const candidate = getCandidate(book, chain, address);
  mergeMarketRow(candidate, info.data, "detail");
  mergeMarketRow(candidate, security.data, "detail-security");
  const scored = scoreCandidate(candidate, config);
  console.log(JSON.stringify({
    chain,
    address,
    symbol: scored.symbol,
    name: scored.name,
    verdict: scored.hardStops.length ? "BLOCK" : scored.risks.length ? "CAUTION" : "NO_HARD_STOP_FOUND",
    hardStops: scored.hardStops,
    risks: scored.risks,
    price: scored.price,
    marketCap: scored.marketCap,
    liquidity: scored.liquidity,
    holderCount: scored.holderCount,
    smartHolderCount: scored.smartHolderCount,
    kolHolderCount: scored.kolHolderCount,
    top10Rate: scored.top10Rate,
    rugRatio: scored.rugRatio,
    isHoneypot: scored.isHoneypot,
    openSource: scored.openSource,
    ownerRenounced: scored.ownerRenounced,
    twitter: scored.twitter,
    website: scored.website
  }, null, 2));
}

export async function loadConfig() {
  const config = await jsonFile(configPath, null);
  if (!config) throw new Error(`配置文件不存在：${configPath}`);
  return config;
}

export async function loadLatestReport() {
  return jsonFile(path.join(outputDir, "latest.json"), null);
}

async function main() {
  const config = await loadConfig();
  const [mode = "scan", chain, address] = process.argv.slice(2);
  if (mode === "scan") return scan(config);
  if (mode === "inspect") return inspect(chain, address, config);
  if (mode === "watch") {
    console.log(`雷达启动，每 ${config.watchIntervalSeconds} 秒扫描一次。按 Ctrl+C 停止。`);
    while (true) {
      const started = Date.now();
      try { await scan(config); }
      catch (error) { console.error(`[scan failed] ${cleanText(error.message)}`); }
      const remaining = Math.max(1_000, config.watchIntervalSeconds * 1000 - (Date.now() - started));
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
  throw new Error("用法：node src/index.mjs <scan|watch|inspect chain address>");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(cleanText(error.stack || error.message));
    process.exitCode = 1;
  });
}
