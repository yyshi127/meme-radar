import test from "node:test";
import assert from "node:assert/strict";
import { enrichSameNameLeaders, selectSameNameLeader } from "../src/same-name.mjs";

const CURRENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LEADER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function payload() {
  return { pairs: [
    { chainId: "bsc", baseToken: { address: LEADER, symbol: "GPU", name: "GPU" }, marketCap: 1_000_000, liquidity: { usd: 10_000 }, url: "https://dexscreener.com/bsc/one" },
    { chainId: "bsc", baseToken: { address: LEADER, symbol: "gpu", name: "GPU" }, marketCap: 900_000, liquidity: { usd: 50_000 }, url: "https://dexscreener.com/bsc/two" },
    { chainId: "bsc", baseToken: { address: CURRENT, symbol: "GPU", name: "GPU Coin" }, marketCap: 500_000, liquidity: { usd: 30_000 } },
    { chainId: "solana", baseToken: { address: "IgnoredAddress1111111111111111111111111", symbol: "GPUX", name: "GPU" }, marketCap: 9_000_000 }
  ] };
}

function memoryStore() {
  const values = new Map();
  return {
    getSameNameCache(key, maxAgeSeconds = Infinity) {
      const value = values.get(key);
      if (!value || Math.floor(Date.now() / 1000) - value.checkedAt > maxAgeSeconds) return null;
      return value;
    },
    putSameNameCache(key, status, value, error = null) {
      values.set(key, { status, payload: value, error, checkedAt: Math.floor(Date.now() / 1000) });
    }
  };
}

function candidate(address) {
  return { key: `bsc:${address}`, chain: "bsc", address, symbol: "GPU", marketCap: 500_000 };
}

test("same-name leader uses exact symbol, deduplicates pools, and ranks current market cap", () => {
  const result = selectSameNameLeader(payload(), "gpu");
  assert.equal(result.status, "ready");
  assert.equal(result.matchCount, 2);
  assert.equal(result.leader.address.toLowerCase(), LEADER);
  assert.equal(result.leader.marketCap, 900_000);
  assert.equal(result.leader.pairUrl, "https://dexscreener.com/bsc/two");
});

test("one exact-symbol search enriches every selected candidate and is cached", async () => {
  const candidates = [candidate(CURRENT), candidate(LEADER)];
  const selected = new Set(candidates.map((item) => item.key));
  const store = memoryStore();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: true, json: async () => payload() };
  };

  const first = await enrichSameNameLeaders(candidates, selected, { store, fetcher });
  assert.deepEqual(first, { selected: 2, ready: 2, empty: 0, failed: 0, cached: 0 });
  assert.equal(calls, 1);
  assert.equal(candidates[0].sameNameLeader.isCurrent, false);
  assert.equal(candidates[0].sameNameLeader.marketCapMultiple, 1.8);
  assert.equal(candidates[1].sameNameLeader.isCurrent, true);

  const cachedCandidate = candidate(CURRENT);
  const cached = await enrichSameNameLeaders([cachedCandidate], new Set([cachedCandidate.key]), {
    store,
    fetcher: async () => assert.fail("cached symbol must not be fetched again")
  });
  assert.deepEqual(cached, { selected: 1, ready: 1, empty: 0, failed: 0, cached: 1 });
});
