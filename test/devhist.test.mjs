import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichDeveloperHistories,
  normalizeDeveloperProfile,
  projectDeveloperHistory
} from "../src/developer-history.mjs";

const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";
const TOKEN_C = "0x3333333333333333333333333333333333333333";
const TOKEN_D = "0x4444444444444444444444444444444444444444";
const CREATOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function historyPayload() {
  return {
    inner_count: 1,
    open_count: 2,
    tokens: [
      { token_address: TOKEN_A, symbol: "CURRENT", token_ath_mc: 20_000 },
      { token_address: TOKEN_B, symbol: "SECOND", token_ath_mc: 200_000 },
      { token_address: TOKEN_C, symbol: "FIRST", token_ath_mc: 900_000 },
      { token_address: TOKEN_D, symbol: "THIRD", token_ath_mc: 80_000 },
      { token_address: TOKEN_C, symbol: "DUPLICATE", token_ath_mc: 1 }
    ]
  };
}

function memoryStore() {
  const values = new Map();
  return {
    getDeveloperHistoryCache(key, maxAgeSeconds = Infinity) {
      const value = values.get(key);
      if (!value || Math.floor(Date.now() / 1000) - value.checkedAt > maxAgeSeconds) return null;
      return value;
    },
    putDeveloperHistoryCache(key, status, payload = null, error = null) {
      values.set(key, { status, payload, error, checkedAt: Math.floor(Date.now() / 1000) });
    }
  };
}

function candidate(address, symbol) {
  return {
    key: `bsc:${address}`,
    chain: "bsc",
    address,
    symbol,
    name: symbol,
    sources: new Set(),
    stages: new Set(),
    signalTypes: new Set(),
    smartMakers: new Set(),
    kolMakers: new Set()
  };
}

test("developer profile deduplicates records and excludes the current token from ATH Top3", () => {
  const profile = normalizeDeveloperProfile(historyPayload(), "bsc", CREATOR);
  assert.equal(profile.tokens.length, 4);
  assert.equal(profile.totalCreatedCount, 4);
  assert.equal(profile.countIsMinimum, true);

  const history = projectDeveloperHistory(profile, TOKEN_A.toUpperCase());
  assert.deepEqual(history.topTokens.map((token) => token.symbol), ["FIRST", "SECOND", "THIRD"]);
  assert.ok(history.topTokens.every((token) => token.address !== TOKEN_A));
});

test("all selected candidates are enriched while one developer is queried only once", async () => {
  const candidates = [candidate(TOKEN_A, "A"), candidate(TOKEN_B, "B")];
  const selected = new Set(candidates.map((item) => item.key));
  const store = memoryStore();
  let infoCalls = 0;
  let historyCalls = 0;
  const gmgn = async (args) => {
    if (args[0] === "token") {
      infoCalls += 1;
      return { data: { dev: { creator_address: CREATOR } }, notices: [] };
    }
    historyCalls += 1;
    assert.deepEqual(args.slice(0, 2), ["portfolio", "created-tokens"]);
    assert.ok(args.includes("token_ath_mc"));
    return { data: historyPayload(), notices: [] };
  };

  const first = await enrichDeveloperHistories(candidates, selected, { gmgn, store, concurrency: 2 });
  assert.deepEqual(first, {
    selected: 2,
    ready: 2,
    failed: 0,
    cached: 0,
    rateLimited: false,
    retryAt: null
  });
  assert.equal(infoCalls, 2);
  assert.equal(historyCalls, 1);
  assert.equal(candidates[0].developerHistory.topTokens[0].symbol, "FIRST");
  assert.ok(candidates[0].developerHistory.topTokens.every((token) => token.address !== TOKEN_A));
  assert.ok(candidates[1].developerHistory.topTokens.every((token) => token.address !== TOKEN_B));

  const cachedCandidates = [candidate(TOKEN_A, "A"), candidate(TOKEN_B, "B")];
  const cached = await enrichDeveloperHistories(cachedCandidates, selected, {
    gmgn: async () => assert.fail("fresh GMGN request should not run for cached candidates"),
    store
  });
  assert.deepEqual(cached, {
    selected: 2,
    ready: 2,
    failed: 0,
    cached: 2,
    rateLimited: false,
    retryAt: null
  });
});
