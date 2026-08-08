import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate } from "../src/core.mjs";
import { refreshWatchMarkets } from "../src/watch-market.mjs";
import { GmgnRateLimitError } from "../src/gmgn.mjs";

test("每轮为所有收藏币刷新行情且不把离榜收藏强行加入候选", async () => {
  const currentAddress = "0x5555555555555555555555555555555555555555";
  const staleAddress = "0x6666666666666666666666666666666666666666";
  const book = new Map();
  const current = getCandidate(book, "bsc", currentAddress);
  current.marketCap = 10_000;
  const updates = [];
  const store = {
    listWatchlist: () => [
      { key: current.key, chain: "bsc", address: currentAddress, snapshot: { developerHistory: { status: "ready" } } },
      { key: `bsc:${staleAddress}`, chain: "bsc", address: staleAddress, snapshot: { symbol: "STALE", sameNameLeader: { status: "ready" } } }
    ],
    updateWatchMarket: (candidate) => {
      updates.push(candidate);
      return true;
    }
  };
  const gmgn = async (args) => ({
    data: {
      address: args[args.indexOf("--address") + 1],
      price: 0.00004,
      market_cap: 40_000,
      liquidity: 18_000
    }
  });

  const result = await refreshWatchMarkets(book, { gmgn, store, notices: [] });

  assert.equal(result.refreshed, 2);
  assert.equal(result.researchEntries.length, 2);
  assert.equal(result.researchEntries[0].candidate.developerHistory.status, "ready");
  assert.equal(result.researchEntries[1].candidate.symbol, "STALE");
  assert.equal(result.researchEntries[1].candidate.sameNameLeader.status, "ready");
  assert.equal(current.marketCap, 40_000);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].marketCap, 40_000);
  assert.equal(book.size, 1);
});

test("收藏行情触发限流后停止后续请求但仍保留全部收藏快照", async () => {
  const addresses = [7, 8, 9].map((index) => `0x${String(index).padStart(40, "0")}`);
  let calls = 0;
  const store = {
    listWatchlist: () => addresses.map((address) => ({
      key: `bsc:${address}`,
      chain: "bsc",
      address,
      snapshot: { symbol: address.slice(-2) }
    })),
    updateWatchMarket: () => true
  };
  const gmgn = async () => {
    calls += 1;
    throw new GmgnRateLimitError(Date.now() + 60_000, true);
  };

  const result = await refreshWatchMarkets(new Map(), { gmgn, store, notices: [] });

  assert.equal(result.rateLimited, true);
  assert.equal(result.researchEntries.length, 3);
  assert.equal(result.refreshed, 0);
  assert.equal(calls, 1);
});
