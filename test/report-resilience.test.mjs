import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshDataStatus, buildStaleReport, reportHasCandidates } from "../src/report-resilience.mjs";

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

test("rate-limited enrichment keeps current market data fresh and marks only partial data", () => {
  const generatedAt = "2026-08-08T02:00:00.000Z";
  const status = buildFreshDataStatus(generatedAt, {
    reason: "enrichment_rate_limited",
    retryAt: "2026-08-08T02:05:00.000Z"
  });

  assert.equal(status.stale, false);
  assert.equal(status.partial, true);
  assert.equal(status.lastSuccessfulAt, generatedAt);
  assert.equal(status.reason, "enrichment_rate_limited");
});
