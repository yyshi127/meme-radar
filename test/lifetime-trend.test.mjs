import test from "node:test";
import assert from "node:assert/strict";
import { getCandidate } from "../src/core.mjs";
import {
  buildLifetimeTrend,
  downsampleKlinePoints,
  enrichLifetimeTrends,
  lifetimeResolution,
  mergeKlinePoints,
  parseKlinePoints
} from "../src/lifetime-trend.mjs";

test("按代币币龄选择不会产生过多蜡烛的 K 线粒度", () => {
  const now = 2_000_000_000;
  assert.equal(lifetimeResolution(now - 3600, now), "1m");
  assert.equal(lifetimeResolution(now - 12 * 3600, now), "5m");
  assert.equal(lifetimeResolution(now - 2 * 86400, now), "15m");
  assert.equal(lifetimeResolution(now - 7 * 86400, now), "1h");
  assert.equal(lifetimeResolution(now - 30 * 86400, now), "4h");
  assert.equal(lifetimeResolution(now - 90 * 86400, now), "1d");
});

test("K 线解析会转成秒、按时间排序并去重", () => {
  const points = parseKlinePoints({
    list: [
      { time: 2_000_000_060_000, close: "2" },
      { time: 2_000_000_000_000, close: "1" },
      { time: 2_000_000_060_000, close: "2.5" },
      { time: 2_000_000_120_000, close: "0" }
    ]
  });
  assert.deepEqual(points, [[2_000_000_000, 1], [2_000_000_060, 2.5]]);

  const merged = mergeKlinePoints(points, [[2_000_000_120, 3]]);
  assert.equal(merged.length, 3);
  const sampled = downsampleKlinePoints(Array.from({ length: 100 }, (_, index) => [index, index + 1]), 20);
  assert.equal(sampled.length, 20);
  assert.deepEqual(sampled[0], [0, 1]);
  assert.deepEqual(sampled.at(-1), [99, 100]);

  const trend = buildLifetimeTrend(merged, {
    createdAt: 2_000_000_000,
    scannedAt: 2_000_000_120,
    updatedAt: 2_000_000_120,
    resolution: "1m"
  });
  assert.equal(trend.status, "ready");
  assert.equal(trend.changePct, 200);
});

test("首次取全生命周期 K 线，后续缓存可增量续接", async () => {
  const now = 2_000_000_120;
  const address = "0x1111111111111111111111111111111111111111";
  const candidate = getCandidate(new Map(), "bsc", address);
  candidate.symbol = "LIFE";
  candidate.creationTimestamp = now - 120;
  let cache = null;
  let calledArgs = null;
  const store = {
    getKlineCache: () => cache,
    putKlineCache: (key, resolution, fromTs, toTs, points, error, checkedAt) => {
      cache = { key, resolution, fromTs, toTs, points, error, checkedAt };
    }
  };
  const gmgn = async (args) => {
    calledArgs = args;
    return {
      data: {
        list: [
          { time: (now - 120) * 1000, close: "1" },
          { time: now * 1000, close: "2" }
        ]
      }
    };
  };

  const result = await enrichLifetimeTrends([candidate], [candidate.key], {
    gmgn,
    store,
    now,
    concurrency: 1,
    cacheSeconds: 0
  });

  assert.equal(result.ready, 1);
  assert.equal(candidate.lifetimeTrend.status, "ready");
  assert.equal(candidate.lifetimeTrend.changePct, 100);
  assert.equal(calledArgs[0], "market");
  assert.equal(calledArgs[1], "kline");
  assert.equal(calledArgs[calledArgs.indexOf("--from") + 1], String(now - 120));
  assert.equal(cache.points.length, 2);
});
