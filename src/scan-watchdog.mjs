export function resolveScanTimeoutSeconds(config, env = process.env) {
  const environmentValue = Number(env.MEME_RADAR_SCAN_TIMEOUT_SECONDS);
  if (Number.isFinite(environmentValue) && environmentValue > 0) return environmentValue;

  const configuredValue = Number(config.scanTimeoutSeconds);
  if (Number.isFinite(configuredValue) && configuredValue > 0) return configuredValue;

  const intervalSeconds = Number(config.watchIntervalSeconds) || 600;
  return Math.max(60, intervalSeconds - 60);
}

export function createScanWatchdog(timeoutMs, onTimeout, timers = {}) {
  const setTimeoutFn = timers.setTimeoutFn || setTimeout;
  const clearTimeoutFn = timers.clearTimeoutFn || clearTimeout;
  let active = true;
  const timer = setTimeoutFn(() => {
    if (active) onTimeout();
  }, timeoutMs);
  timer?.unref?.();

  return () => {
    if (!active) return;
    active = false;
    clearTimeoutFn(timer);
  };
}
