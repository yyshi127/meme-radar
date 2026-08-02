import test from "node:test";
import assert from "node:assert/strict";
import { creationAge } from "../web/src/lib/format.js";

const now = 2_000_000_000 * 1000;

test("代币创建时间格式化为分钟、小时和天", () => {
  assert.equal(creationAge(2_000_000_000 - 30, now), "刚刚创建");
  assert.equal(creationAge(2_000_000_000 - 60 * 35, now), "创建 35分钟");
  assert.equal(creationAge(2_000_000_000 - 3600, now), "创建 1小时");
  assert.equal(creationAge(2_000_000_000 - 86400, now), "创建 1天");
});

test("创建时间缺失时不伪造雷达首次发现时间", () => {
  assert.equal(creationAge(null, now), "创建时间未知");
  assert.equal(creationAge(0, now), "创建时间未知");
});
