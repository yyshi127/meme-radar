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
    priority: "WATCH"
  };

  try {
    const first = createRadarStore(file);
    first.addWatch(candidate);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 0);
    first.syncWatchSnapshots([{ ...candidate, priority: "SKIP" }], 1_800_000_000);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 0);
    first.syncWatchSnapshots([candidate, candidate], 1_800_000_300);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 1);
    first.syncWatchSnapshots([], 1_800_000_600);
    assert.equal(first.listWatchlist([])[0].hitCount, 1);
    first.syncWatchSnapshots([{ ...candidate, priority: "ALERT" }], 1_800_000_900);
    assert.equal(first.listWatchlist([candidate])[0].hitCount, 2);
    first.putKlineCache(candidate.key, "5m", 1_800_000_000, 1_800_000_900, [[1_800_000_000, 1], [1_800_000_900, 2]], null, 1_800_000_900);
    assert.equal(first.getKlineCache(candidate.key).points.length, 2);
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
    assert.equal(reopened.removeWatch(candidate.chain, candidate.address), true);
    assert.deepEqual(reopened.listWatchlist([]), []);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
