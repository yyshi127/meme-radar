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
  assert.equal(topHolderCalls, 2);
  assert.equal(candidate.verificationStatus, "verified");
  assert.equal(cached[1], "verified");
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
