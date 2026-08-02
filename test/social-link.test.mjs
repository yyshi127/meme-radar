import test from "node:test";
import assert from "node:assert/strict";
import { twitterProfileUrl } from "../web/src/lib/social.js";

test("Twitter 用户名转换为 X 主页链接", () => {
  assert.equal(twitterProfileUrl("@BeeStock_BSC"), "https://x.com/BeeStock_BSC");
  assert.equal(twitterProfileUrl("moon_token"), "https://x.com/moon_token");
});

test("只接受 X/Twitter 官方域名并拒绝危险或伪造链接", () => {
  assert.equal(twitterProfileUrl("https://twitter.com/moon_token"), "https://twitter.com/moon_token");
  assert.equal(twitterProfileUrl("javascript:alert(1)"), null);
  assert.equal(twitterProfileUrl("https://example.com/x.com/moon_token"), null);
  assert.equal(twitterProfileUrl("?"), null);
});
