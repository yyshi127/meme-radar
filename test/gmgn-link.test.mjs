import test from "node:test";
import assert from "node:assert/strict";
import { gmgnAppIntentUrl, gmgnTokenUrl } from "../web/src/lib/gmgn.js";

test("GMGN 网页链接使用官方代币路径", () => {
  assert.equal(gmgnTokenUrl("BSC", "0xabc"), "https://gmgn.ai/bsc/token/0xabc");
  assert.equal(gmgnTokenUrl("robinhood", "0xabc"), "https://gmgn.ai/robinhood/token/0xabc");
  assert.equal(gmgnTokenUrl("eth", "0xabc"), null);
});

test("GMGN 移动端链接指定官方 Android 包并保留网页回退", () => {
  const webUrl = "https://gmgn.ai/sol/token/abc123";
  const intentUrl = gmgnAppIntentUrl("sol", "abc123");
  assert.match(intentUrl, /^intent:\/\/gmgn\.ai\/sol\/token\/abc123#Intent;/);
  assert.match(intentUrl, /scheme=https;/);
  assert.match(intentUrl, /package=com\.gmgn\.app;/);
  assert.ok(intentUrl.includes(`S.browser_fallback_url=${encodeURIComponent(webUrl)};`));
  assert.match(gmgnAppIntentUrl("robinhood", "0xabc"), /^intent:\/\/gmgn\.ai\/robinhood\/token\/0xabc#Intent;/);
  assert.equal(gmgnAppIntentUrl("eth", "0xabc"), null);
});
