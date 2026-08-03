import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRadarStore } from "../src/store.mjs";

test("收藏在重启后保留最后快照，刷新扫描不会丢失", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "meme-radar-store-"));
  const file = path.join(directory, "radar.sqlite");
  const candidate = {
    key: "bsc:0x1111111111111111111111111111111111111111",
    chain: "bsc",
    address: "0x1111111111111111111111111111111111111111",
    symbol: "KEEP",
    score: 72,
    priority: "WATCH",
    developerHistory: { status: "ready", totalCreatedCount: 4, topTokens: [] },
    sameNameLeader: { status: "ready", leader: { symbol: "KEEP", marketCap: 80_000 } }
  };

  try {
    const first = createRadarStore(file);
    first.addWatch(candidate);
    const initiallyPersisted = first.listWatchlist([])[0];
    assert.equal(initiallyPersisted.snapshot.developerHistory.totalCreatedCount, 4);
    assert.equal(initiallyPersisted.snapshot.sameNameLeader.leader.marketCap, 80_000);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 0);
    first.syncWatchSnapshots([{ ...candidate, priority: "SKIP" }], 1_800_000_000);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 0);
    first.syncWatchSnapshots([candidate, candidate], 1_800_000_300);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 1);
    first.syncWatchSnapshots([], 1_800_000_600);
    assert.equal(first.listWatchlist([])[0].hitCount, 1);
    first.syncWatchSnapshots([{ ...candidate, priority: "ALERT" }], 1_800_000_900);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 2);
    assert.equal(first.updateWatchMarket({
      ...candidate,
      price: 0.000025,
      marketCap: 25_000,
      liquidity: 12_000
    }, 1_800_001_200), true);
    const marketRefreshed = first.listWatchlist([])[0];
    assert.equal(marketRefreshed.snapshot.price, 0.000025);
    assert.equal(marketRefreshed.snapshot.marketCap, 25_000);
    assert.equal(marketRefreshed.snapshot.liquidity, 12_000);
    assert.equal(marketRefreshed.snapshot.marketUpdatedAt, "2027-01-15T08:20:00.000Z");
    assert.equal(marketRefreshed.hitCount, 2);
    assert.equal(first.updateWatchResearch({
      ...candidate,
      creatorAddress: "0x2222222222222222222222222222222222222222",
      developerHistory: { status: "ready", totalCreatedCount: 5, topTokens: [] },
      sameNameLeader: { status: "ready", leader: { symbol: "KEEP", marketCap: 90_000 } }
    }, 1_800_001_500), true);
    const researchRefreshed = first.listWatchlist([])[0];
    assert.equal(researchRefreshed.snapshot.developerHistory.totalCreatedCount, 5);
    assert.equal(researchRefreshed.snapshot.sameNameLeader.leader.marketCap, 90_000);
    assert.equal(researchRefreshed.snapshot.researchUpdatedAt, "2027-01-15T08:25:00.000Z");
    assert.equal(researchRefreshed.hitCount, 2);
    assert.equal(first.updateWatchResearch({
      chain: candidate.chain,
      address: candidate.address,
      developerHistory: researchRefreshed.snapshot.developerHistory
    }, 1_800_001_800), false);
    first.putKlineCache(candidate.key, "5m", 1_800_000_000, 1_800_000_900, [[1_800_000_000, 1], [1_800_000_900, 2]], null, 1_800_000_900);
    assert.equal(first.getKlineCache(candidate.key).points.length, 2);
    first.putDeveloperHistoryCache(`token:${candidate.key}`, "ready", {
      history: { version: 1, status: "ready", totalCreatedCount: 4, topTokens: [] }
    });
    assert.equal(first.getDeveloperHistoryCache(`token:${candidate.key}`).payload.history.totalCreatedCount, 4);
    first.putSameNameCache("symbol:KEEP", "ready", {
      version: 1,
      status: "ready",
      leader: { symbol: "KEEP", marketCap: 90_000 }
    });
    assert.equal(first.getSameNameCache("symbol:KEEP").payload.leader.marketCap, 90_000);
    first.close();

    const reopened = createRadarStore(file);
    const stale = reopened.listWatchlist([])[0];
    assert.equal(stale.snapshot.symbol, "KEEP");
    assert.equal(stale.snapshot.score, 72);
    assert.equal(stale.isLive, false);
    assert.equal(stale.snapshot.watched, true);
    assert.equal(stale.hitCount, 2);
    assert.equal(stale.snapshot.watchHitCount, 2);
    assert.equal(reopened.getKlineCache(candidate.key).resolution, "5m");
    assert.deepEqual(reopened.getKlineCache(candidate.key).points.at(-1), [1_800_000_900, 2]);
    assert.equal(reopened.getDeveloperHistoryCache(`token:${candidate.key}`).status, "ready");
    assert.equal(reopened.getDeveloperHistoryCache(`token:${candidate.key}`).payload.history.totalCreatedCount, 4);
    assert.equal(reopened.getSameNameCache("symbol:KEEP").payload.leader.symbol, "KEEP");
    assert.equal(reopened.removeWatch(candidate.chain, candidate.address), true);
    assert.deepEqual(reopened.listWatchlist([]), []);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
