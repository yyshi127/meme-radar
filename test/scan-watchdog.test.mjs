import test from "node:test";
import assert from "node:assert/strict";
import { createScanWatchdog, resolveScanTimeoutSeconds } from "../src/scan-watchdog.mjs";

test("scan timeout uses the environment override, config value, then an interval-based fallback", () => {
  assert.equal(resolveScanTimeoutSeconds({ scanTimeoutSeconds: 540, watchIntervalSeconds: 600 }, {}), 540);
  assert.equal(resolveScanTimeoutSeconds({ scanTimeoutSeconds: 540, watchIntervalSeconds: 600 }, { MEME_RADAR_SCAN_TIMEOUT_SECONDS: "120" }), 120);
  assert.equal(resolveScanTimeoutSeconds({ watchIntervalSeconds: 600 }, {}), 540);
  assert.equal(resolveScanTimeoutSeconds({ watchIntervalSeconds: 90 }, {}), 60);
});

test("scan watchdog exits only when it has not been cancelled", () => {
  let callback;
  let timeout;
  let cleared = false;
  let unrefCalled = false;
  let timedOut = false;
  const timer = { unref() { unrefCalled = true; } };
  const timers = {
    setTimeoutFn(nextCallback, nextTimeout) {
      callback = nextCallback;
      timeout = nextTimeout;
      return timer;
    },
    clearTimeoutFn(value) {
      assert.equal(value, timer);
      cleared = true;
    }
  };

  const cancel = createScanWatchdog(540_000, () => { timedOut = true; }, timers);
  assert.equal(timeout, 540_000);
  assert.equal(unrefCalled, true);
  cancel();
  callback();
  assert.equal(cleared, true);
  assert.equal(timedOut, false);
});

test("scan watchdog invokes the timeout handler while active", () => {
  let callback;
  let timedOut = false;
  createScanWatchdog(1, () => { timedOut = true; }, {
    setTimeoutFn(nextCallback) {
      callback = nextCallback;
      return {};
    },
    clearTimeoutFn() {}
  });
  callback();
  assert.equal(timedOut, true);
});
