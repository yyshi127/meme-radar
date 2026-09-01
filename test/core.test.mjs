import test from "node:test";
import assert from "node:assert/strict";
import { assessSafety, buildNarrativeProfile, getCandidate, isValidAddress, mergeMarketRow, mergeSignal, mergeTrade, scoreCandidate, scoreCandidateEarly, scoreCandidateLegacy } from "../src/core.mjs";

const SOL = "So11111111111111111111111111111111111111112";

function candidate() {
  return getCandidate(new Map(), "sol", SOL);
}

test("叙事优先采用项目方简介，并区分名称推断与资料不足", () => {
  const projectNarrative = buildNarrativeProfile({
    symbol: "AIBOT",
    name: "AI Robot",
    narrativeDescription: "An autonomous robot community token.",
    twitter: "https://x.com/aibot",
    website: "https://aibot.example"
  });
  assert.equal(projectNarrative.source, "project");
  assert.equal(projectNarrative.category, "AI / 科技");
  assert.equal(projectNarrative.summary, "An autonomous robot community token.");
  assert.equal(projectNarrative.completeness, 90);

  const inferred = buildNarrativeProfile({ symbol: "BABYASTEROID", name: "BabyAsteroid" });
  assert.equal(inferred.source, "inferred");
  assert.equal(inferred.category, "太空 / 科幻");
  assert.match(inferred.summary, /尚未获取项目方简介/);

  assert.equal(buildNarrativeProfile({ symbol: "BTCAT", name: "BitCat" }).category, "动物 Meme");

  const unknown = buildNarrativeProfile({ symbol: "XYZ", name: "XYZ" });
  assert.equal(unknown.source, "unknown");
  assert.equal(unknown.completeness, 0);
});

test("GMGN link.description 被清洗并进入评分结果的叙事卡", () => {
  const item = candidate();
  mergeMarketRow(item, {
    symbol: "MOON",
    name: "Moon Story",
    link: { description: "  A moon\ncommunity story.  ", twitter_username: "moon" }
  }, "detail");
  const result = scoreCandidateLegacy(item);
  assert.equal(result.narrative.source, "project");
  assert.equal(result.narrative.summary, "A moon community story.");
});

test("三钱包聪明钱集群 + 市场信号进入 ALERT", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "EARLY",
    market_cap: 250000,
    liquidity: 60000,
    smart_degen_count: 3,
    top_10_holder_rate: 0.18,
    rug_ratio: 0.05,
    bundler_rate: 0.05,
    rat_trader_amount_rate: 0.04,
    renounced_mint: 1,
    renounced_freeze_account: 1,
    creation_timestamp: 2_000_000_000 - 1200,
    website: "https://example.test"
  }, "trending");
  for (let i = 0; i < 3; i += 1) mergeTrade(item, { maker: `wallet${i}`, amount_usd: 1000, timestamp: 2_000_000_000, side: "buy" }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });
  const result = scoreCandidate(item, { now: 2_000_000_000, alertScore: 70, watchScore: 50 });
  assert.equal(result.priority, "ALERT");
  assert.ok(result.evidenceFamilyCount >= 2);
  assert.ok(result.score >= 70);
});

test("高 rug 风险始终硬过滤", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "RUG",
    rug_ratio: 0.8,
    liquidity: 100000,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  for (let i = 0; i < 5; i += 1) mergeTrade(item, { maker: `kol${i}`, amount_usd: 5000, timestamp: 2_000_000_000, side: "buy" }, "kol");
  const result = scoreCandidate(item, { now: 2_000_000_000 });
  assert.equal(result.priority, "SKIP");
  assert.match(result.hardStops.join(" "), /Rug/);
  assert.equal(result.safetyScore, 0);
  assert.equal(result.safetyStatus, "blocked");
});

test("保守模式下 Rug 风险达到 0.10 即取消推荐资格", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    market_cap: 100000,
    liquidity: 30000,
    holder_count: 500,
    rug_ratio: 0.1,
    top_10_holder_rate: 0.1,
    bundler_rate: 0.01,
    rat_trader_amount_rate: 0.01,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  const result = scoreCandidateEarly(item);
  assert.equal(result.priority, "SKIP");
  assert.equal(result.safetyScore, 0);
  assert.match(result.safetyHardStops.join(" "), /Rug/);
});

test("猎星候选始终提供安全分，安全数据不完整时不得进入 ALERT", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    market_cap: 100000,
    liquidity: 30000,
    holder_count: 500,
    rug_ratio: 0.02,
    top_10_holder_rate: 0.1,
    bundler_rate: 0.01,
    rat_trader_amount_rate: 0.01,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  for (let i = 0; i < 4; i += 1) mergeTrade(item, { maker: `wallet-${i}`, amount_usd: 1000, timestamp: 2_000_000_000 }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });

  const result = scoreCandidateEarly(item, { now: 2_000_000_000 });
  assert.ok(Number.isFinite(result.safetyScore));
  assert.equal(result.safetyStatus, "pending");
  assert.ok(result.dataCompleteness < 100);
  assert.notEqual(result.priority, "ALERT");
});

test("Top100 与关键字段完整且无硬风险时安全状态通过", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    market_cap: 100000,
    liquidity: 30000,
    holder_count: 500,
    rug_ratio: 0.02,
    top_10_holder_rate: 0.1,
    bundler_rate: 0.01,
    rat_trader_amount_rate: 0.01,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  item.holderAnalysis = {
    status: "verified",
    relatedRate: 0,
    coordinatedRate: 0,
    riskWalletRate: 0.01,
    insiderRate: 0,
    largestWalletRate: 0.05,
    bundlerRate: 0.01,
    airdropRate: 0.01,
    devHoldingRate: 0,
    devSockPuppet: false
  };
  const result = assessSafety(item);
  assert.equal(result.safetyStatus, "verified");
  assert.equal(result.dataCompleteness, 100);
  assert.ok(result.safetyScore > 0);
});

test("没有触发单项硬风险但综合安全分低于 70 时只能观察", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    market_cap: 250000,
    liquidity: 60000,
    holder_count: 800,
    rug_ratio: 0.05,
    top_10_holder_rate: 0.3,
    bundler_rate: 0.05,
    rat_trader_amount_rate: 0.05,
    renounced_mint: 1,
    renounced_freeze_account: 1,
    creation_timestamp: 2_000_000_000 - 900,
    website: "https://example.test"
  }, "trending");
  for (let i = 0; i < 4; i += 1) mergeTrade(item, { maker: `safe-${i}`, amount_usd: 1000, timestamp: 2_000_000_000 }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });
  item.holderAnalysis = {
    status: "verified",
    relatedRate: 0.03,
    coordinatedRate: 0.02,
    riskWalletRate: 0.1,
    insiderRate: 0.05,
    largestWalletRate: 0.1,
    bundlerRate: 0.05,
    airdropRate: 0.05,
    devHoldingRate: 0.02,
    devSockPuppet: false
  };

  const result = scoreCandidateEarly(item, { now: 2_000_000_000 });
  assert.equal(result.safetyStatus, "verified");
  assert.ok(result.safetyScore < 70);
  assert.equal(result.priority, "WATCH");
});

test("只靠单个 KOL 不会报警", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "HYPE",
    market_cap: 100000,
    liquidity: 20000,
    rug_ratio: 0.05,
    top_10_holder_rate: 0.15,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "new-creation", "new-creation");
  mergeTrade(item, { maker: "kol1", amount_usd: 10000, timestamp: 2_000_000_000, side: "buy" }, "kol");
  const result = scoreCandidate(item, { now: 2_000_000_000 });
  assert.notEqual(result.priority, "ALERT");
});

test("涨幅过大的 LATE 候选不会报警", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "LATE",
    market_cap: 100000,
    liquidity: 80000,
    price_change_percent1h: 300,
    smart_degen_count: 10,
    rug_ratio: 0.01,
    top_10_holder_rate: 0.1,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  for (let i = 0; i < 5; i += 1) mergeTrade(item, { maker: `smart${i}`, amount_usd: 1000, timestamp: 2_000_000_000, side: "buy" }, "smart");
  const result = scoreCandidate(item, { now: 2_000_000_000 });
  assert.equal(result.phase, "LATE");
  assert.notEqual(result.priority, "ALERT");
});

test("流动性低于 10k 即使聪明钱聚集也硬过滤", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "THIN",
    market_cap: 30000,
    liquidity: 9000,
    smart_degen_count: 10,
    rug_ratio: 0.01,
    top_10_holder_rate: 0.1,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  for (let i = 0; i < 5; i += 1) mergeTrade(item, { maker: `smart${i}`, amount_usd: 1000, timestamp: 2_000_000_000, side: "buy" }, "smart");
  const result = scoreCandidate(item, { now: 2_000_000_000 });
  assert.equal(result.priority, "SKIP");
  assert.match(result.hardStops.join(" "), /流动性/);
});

test("Top100 验证发现 bundler 超过 20% 时硬过滤", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "BUNDLE",
    market_cap: 250000,
    liquidity: 60000,
    rug_ratio: 0.02,
    top_10_holder_rate: 0.2,
    bundler_rate: 0.22,
    rat_trader_amount_rate: 0.02,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  item.holderAnalysis = { status: "verified", relatedRate: 0, coordinatedRate: 0, riskWalletRate: 0.22, insiderRate: 0, largestWalletRate: 0.08, airdropRate: 0 };
  const result = scoreCandidate(item, { now: 2_000_000_000, requireVerification: true });
  assert.equal(result.priority, "SKIP");
  assert.match(result.hardStops.join(" "), /Bundler/);
});

test("关键风险字段或 Top100 尽调缺失时不得进入 ALERT", () => {
  const item = candidate();
  mergeMarketRow(item, { address: SOL, symbol: "UNVERIFIED", market_cap: 250000, liquidity: 60000 }, "trending");
  for (let i = 0; i < 4; i += 1) mergeTrade(item, { maker: `wallet-${i}`, amount_usd: 1000, timestamp: 2_000_000_000 }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });
  const result = scoreCandidate(item, { now: 2_000_000_000, requireVerification: true });
  assert.notEqual(result.priority, "ALERT");
  assert.ok(result.alertBlocks.some((reason) => reason.includes("尽调")));
  assert.ok(result.missingRiskFields.length > 0);
});

test("潜力发现保留宽松候选，安全确认仍能因关联控盘过滤", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "DUAL",
    market_cap: 250000,
    liquidity: 60000,
    smart_degen_count: 3,
    rug_ratio: 0.02,
    top_10_holder_rate: 0.18,
    bundler_rate: 0.05,
    rat_trader_amount_rate: 0.02,
    renounced_mint: 1,
    renounced_freeze_account: 1,
    creation_timestamp: 2_000_000_000 - 900,
    website: "https://example.test"
  }, "trending", "near-completion");
  for (let i = 0; i < 3; i += 1) mergeTrade(item, { maker: `dual-${i}`, amount_usd: 1000, timestamp: 2_000_000_000 }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });

  const discovery = scoreCandidateLegacy(item, { now: 2_000_000_000 });
  item.holderAnalysis = {
    status: "verified",
    relatedRate: 0.25,
    coordinatedRate: 0,
    riskWalletRate: 0,
    insiderRate: 0,
    largestWalletRate: 0.08,
    airdropRate: 0
  };
  const safety = scoreCandidate(item, { now: 2_000_000_000, strategy: "safety", requireVerification: true });

  assert.equal(discovery.priority, "ALERT");
  assert.equal(safety.priority, "SKIP");
  assert.ok(discovery.score > safety.score);
  assert.match(safety.hardStops.join(" "), /关联钱包/);
});

test("猎星 legacy-v1 与改造前固定样本得分一致", () => {
  const item = candidate();
  mergeMarketRow(item, {
    address: SOL,
    symbol: "LEGACY",
    market_cap: 250000,
    liquidity: 60000,
    smart_degen_count: 3,
    rug_ratio: 0.05,
    top_10_holder_rate: 0.18,
    bundler_rate: 0.05,
    rat_trader_amount_rate: 0.04,
    renounced_mint: 1,
    renounced_freeze_account: 1,
    creation_timestamp: 2_000_000_000 - 1200,
    website: "https://example.test"
  }, "trending");
  for (let i = 0; i < 3; i += 1) mergeTrade(item, { maker: `legacy-${i}`, amount_usd: 1000, timestamp: 2_000_000_000 }, "smart");
  mergeSignal(item, { signal_type: 12, token_address: SOL, data: {} });

  const result = scoreCandidateLegacy(item, { now: 2_000_000_000 });
  assert.equal(result.score, 89);
  assert.equal(result.priority, "ALERT");
  assert.equal(result.strategy, "legacy-v1");
});

test("猎星 early-v3 硬过滤持币地址不超过 300 的候选", () => {
  const blocked = candidate();
  mergeMarketRow(blocked, {
    address: SOL,
    market_cap: 100000,
    liquidity: 30000,
    holder_count: 300,
    rug_ratio: 0.01,
    top_10_holder_rate: 0.1,
    bundler_rate: 0.01,
    rat_trader_amount_rate: 0.01,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  assert.equal(scoreCandidateEarly(blocked).priority, "SKIP");
  assert.match(scoreCandidateEarly(blocked).hardStops.join(" "), /持币地址 300/);

  const allowed = candidate();
  mergeMarketRow(allowed, {
    address: SOL,
    market_cap: 100000,
    liquidity: 30000,
    holder_count: 301,
    rug_ratio: 0.01,
    top_10_holder_rate: 0.1,
    bundler_rate: 0.01,
    rat_trader_amount_rate: 0.01,
    renounced_mint: 1,
    renounced_freeze_account: 1
  }, "trending");
  assert.doesNotMatch(scoreCandidateEarly(allowed).hardStops.join(" "), /持币地址/);
});

test("猎星 early-v3 只允许 $10k–$2M 市值区间", () => {
  for (const [marketCap, shouldBlock] of [[9_999, true], [10_000, false], [2_000_000, false], [2_000_001, true]]) {
    const item = candidate();
    mergeMarketRow(item, {
      address: SOL,
      market_cap: marketCap,
      liquidity: 30000,
      holder_count: 500,
      rug_ratio: 0.01,
      top_10_holder_rate: 0.1,
      bundler_rate: 0.01,
      rat_trader_amount_rate: 0.01,
      renounced_mint: 1,
      renounced_freeze_account: 1
    }, "trending");
    const result = scoreCandidateEarly(item);
    assert.equal(result.hardStops.some((reason) => reason.includes("市值不在")), shouldBlock, `${marketCap} 边界判断错误`);
  }
});

test("token info merges the developer creator address", () => {
  const item = candidate();
  const creatorAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  mergeMarketRow(item, { dev: { creator_address: creatorAddress } }, "token-info");
  assert.equal(item.creatorAddress, creatorAddress);
});

test("Robinhood Chain uses EVM address validation", () => {
  const address = "0x0423bed328942cb8bf79726b986893e1eb863cba";
  assert.equal(isValidAddress("robinhood", address), true);
  assert.equal(isValidAddress("robinhood", "not-an-evm-address"), false);
  assert.ok(getCandidate(new Map(), "robinhood", address));
});
