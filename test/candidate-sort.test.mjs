import assert from "node:assert/strict";
import test from "node:test";
import { sortCandidatesByMarketCap } from "../web/src/lib/candidate-sort.js";

const candidates = [
  { symbol: "MID", marketCap: 100_000 },
  { symbol: "UNKNOWN", marketCap: null },
  { symbol: "HIGH", marketCap: 500_000 },
  { symbol: "LOW", marketCap: 20_000 }
];

test("市值排序支持升序和降序，未知市值始终排在最后", () => {
  assert.deepEqual(sortCandidatesByMarketCap(candidates, "asc").map((item) => item.symbol), ["LOW", "MID", "HIGH", "UNKNOWN"]);
  assert.deepEqual(sortCandidatesByMarketCap(candidates, "desc").map((item) => item.symbol), ["HIGH", "MID", "LOW", "UNKNOWN"]);
});

test("默认排序保持雷达原始排名", () => {
  assert.equal(sortCandidatesByMarketCap(candidates, "default"), candidates);
});
