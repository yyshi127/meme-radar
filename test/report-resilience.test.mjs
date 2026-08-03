import test from "node:test";
import assert from "node:assert/strict";
import { buildStaleReport, reportHasCandidates } from "../src/report-resilience.mjs";

test("stale scan keeps the last successful candidates without repeating alerts", () => {
  const previous = {
    generatedAt: "2026-08-03T02:00:00.000Z",
    candidates: [{ key: "bsc:abc", symbol: "ABC" }],
    discoveryCandidates: [{ key: "bsc:abc", symbol: "ABC" }],
    alerts: [{ key: "bsc:abc" }],
    errors: []
  };
  const result = buildStaleReport(previous, {
    generatedAt: "2026-08-03T03:00:00.000Z",
    reason: "gmgn_rate_limited",
    retryAt: "2026-08-03T03:05:00.000Z",
    errors: ["GMGN rate limited"]
  });

  assert.equal(reportHasCandidates(previous), true);
  assert.deepEqual(result.candidates, previous.candidates);
  assert.deepEqual(result.discoveryCandidates, previous.discoveryCandidates);
  assert.deepEqual(result.alerts, []);
  assert.equal(result.dataStatus.stale, true);
  assert.equal(result.dataStatus.lastSuccessfulAt, previous.generatedAt);
  assert.equal(result.dataStatus.retryAt, "2026-08-03T03:05:00.000Z");
});
