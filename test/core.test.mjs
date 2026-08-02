import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate, mergeMarketRow, mergeSignal, mergeTrade, scoreCandidate, scoreCandidateLegacy } from "../src/core.mjs";

const SOL = "So11111111111111111111111111111111111111112";

function candidate() {
  return getCandidate(new Map(), "sol", SOL);
}

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
