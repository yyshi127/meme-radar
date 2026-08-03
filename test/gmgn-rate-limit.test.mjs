import test from "node:test";
import assert from "node:assert/strict";
import {
  createGmgnClient,
  gmgnRequestWeight,
  parseRateLimitReset
} from "../src/gmgn.mjs";

test("GMGN routes use their documented weights", () => {
  assert.equal(gmgnRequestWeight(["market", "trending"]), 1);
  assert.equal(gmgnRequestWeight(["market", "kline"]), 2);
  assert.equal(gmgnRequestWeight(["token", "holders"]), 5);
  assert.equal(gmgnRequestWeight(["portfolio", "created-tokens"]), 2);
  assert.equal(gmgnRequestWeight(["unknown", "route"]), 3);
});

test("rate-limit reset time is parsed from GMGN errors", () => {
  assert.equal(parseRateLimitReset('{"reset_at":1775184222}'), 1_775_184_222_000);
  assert.equal(
    parseRateLimitReset("Rate limit resets at 2026-08-03 11:07:57 GMT+08:00"),
    Date.parse("2026-08-03T11:07:57+08:00")
  );
  assert.equal(parseRateLimitReset("~40s remaining", 1000), 41_000);
});

test("first 429 opens the circuit and prevents another upstream request", async () => {
  const now = Date.parse("2026-08-03T03:00:00Z");
  let calls = 0;
  const client = createGmgnClient({
    now: () => now,
    execute: async () => {
      calls += 1;
      const error = new Error("429");
      error.stderr = '{"code":429,"error":"RATE_LIMIT_BANNED","reset_at":1785726300}';
      throw error;
    }
  });

  await assert.rejects(client(["market", "trending"]), { code: "GMGN_RATE_LIMITED" });
  await assert.rejects(client(["token", "info"]), { code: "GMGN_RATE_LIMIT_OPEN" });
  assert.equal(calls, 1);
  assert.equal(client.status().blocked, true);
  assert.equal(client.status().retryAt, "2026-08-03T03:05:00.000Z");
});
