import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate } from "../src/core.mjs";
import { enrichDeepCandidates } from "../src/deep-analysis.mjs";

test("Top100 持仓接口瞬时超时会自动重试", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const candidate = getCandidate(new Map(), "bsc", address);
  candidate.symbol = "RETRY";
  let holderCalls = 0;
  let cached = null;
  const gmgn = async (args) => {
    if (args.includes("holders")) {
      holderCalls += 1;
      if (holderCalls === 1) throw new Error("ConnectTimeoutErr");
      return { data: { list: [{ address: "holder", addr_type: 0, amount_percentage: 0.05 }] } };
    }
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
  assert.equal(holderCalls, 2);
  assert.equal(candidate.verificationStatus, "verified");
  assert.equal(cached[1], "verified");
});
