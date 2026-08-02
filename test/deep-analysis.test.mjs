import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate } from "../src/core.mjs";
import { enrichDeepCandidates } from "../src/deep-analysis.mjs";

test("Top100 持仓接口瞬时超时会自动重试", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const candidate = getCandidate(new Map(), "bsc", address);
  candidate.symbol = "RETRY";
  let topHolderCalls = 0;
  let cached = null;
  const gmgn = async (args) => {
    if (args.includes("holders") && !args.includes("--tag")) {
      topHolderCalls += 1;
      if (topHolderCalls === 1) throw new Error("ConnectTimeoutErr");
      return { data: { list: [{ address: "holder", addr_type: 0, amount_percentage: 0.05 }] } };
    }
    if (args.includes("holders")) return { data: { list: [] } };
    if (args.includes("info")) return { data: { link: { description: "A retry community narrative." } } };
    return { data: { open_source: 1, renounced: 1, is_honeypot: 0 } };
  };
  const store = {
    getHolderCache: () => null,
    putHolderCache: (...args) => { cached = args; }
  };

  const result = await enrichDeepCandidates([candidate], [{ key: candidate.key, priority: "WATCH", score: 60 }], {
    gmgn,
    store,
    limit: 1,
    concurrency: 1
  });

  assert.equal(result.selected, 1);
  assert.deepEqual(result.selectedKeys, [candidate.key]);
  assert.equal(topHolderCalls, 2);
  assert.equal(candidate.verificationStatus, "verified");
  assert.equal(candidate.narrativeDescription, "A retry community narrative.");
  assert.equal(cached[1], "verified");
  assert.equal(cached[2].metadataVersion, 1);
});

test("深度分析名额优先覆盖 ALERT/WATCH，而不是高分 SKIP", async () => {
  const skipped = getCandidate(new Map(), "bsc", "0x2222222222222222222222222222222222222222");
  const watched = getCandidate(new Map(), "bsc", "0x3333333333333333333333333333333333333333");
  const gmgn = async (args) => args.includes("security")
    ? { data: {} }
    : { data: { list: args.includes("--tag") ? [] : [{ address: "holder", addr_type: 0, amount_percentage: 0.05 }] } };
  const store = { getHolderCache: () => null, putHolderCache: () => {} };

  await enrichDeepCandidates(
    [skipped, watched],
    [
      { key: skipped.key, priority: "SKIP", score: 99 },
      { key: watched.key, priority: "WATCH", score: 55 }
    ],
    { gmgn, store, limit: 1, concurrency: 1 }
  );

  assert.equal(watched.verificationStatus, "verified");
  assert.equal(skipped.verificationStatus, "pending");
});

test("深度分析缓存不得覆盖本轮最新行情", async () => {
  const candidate = getCandidate(new Map(), "bsc", "0x4444444444444444444444444444444444444444");
  candidate.price = 0.00004;
  candidate.marketCap = 40_000;
  candidate.liquidity = 18_000;
  const store = {
    getHolderCache: () => ({
      status: "verified",
      checkedAt: 1_800_000_000,
      payload: {
        metadataVersion: 1,
        holderAnalysis: { status: "verified", analysisVersion: 4 },
        info: {
          price: 0.000031,
          market_cap: 31_000,
          liquidity: 16_000,
          link: { description: "Cached project description." }
        },
        security: { is_open_source: 1, is_renounced: 1, is_honeypot: 0 }
      }
    }),
    putHolderCache: () => {}
  };

  await enrichDeepCandidates(
    [candidate],
    [{ key: candidate.key, priority: "WATCH", score: 60 }],
    { gmgn: async () => { throw new Error("不应重新请求"); }, store, limit: 1, concurrency: 1 }
  );

  assert.equal(candidate.price, 0.00004);
  assert.equal(candidate.marketCap, 40_000);
  assert.equal(candidate.liquidity, 18_000);
  assert.equal(candidate.narrativeDescription, "Cached project description.");
  assert.equal(candidate.openSource, true);
});
