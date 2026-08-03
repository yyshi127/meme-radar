import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate } from "../src/core.mjs";
import { refreshWatchMarkets } from "../src/watch-market.mjs";

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
