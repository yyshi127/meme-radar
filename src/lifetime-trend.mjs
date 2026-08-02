import { isValidAddress } from "./core.mjs";

const resolutionSeconds = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60
};

export function lifetimeResolution(createdAt, scannedAt) {
  const age = Math.max(0, Number(scannedAt) - Number(createdAt));
  if (age <= 4 * 3600) return "1m";
  if (age <= 24 * 3600) return "5m";
  if (age <= 3 * 86400) return "15m";
  if (age <= 14 * 86400) return "1h";
  if (age <= 60 * 86400) return "4h";
  return "1d";
}

export function parseKlinePoints(payload) {
  const candles = Array.isArray(payload?.list)
    ? payload.list
    : Array.isArray(payload?.data?.list)
      ? payload.data.list
      : [];
  const byTime = new Map();
  for (const candle of candles) {
    let time = Number(candle?.time);
    const close = Number(candle?.close);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
    if (time > 10_000_000_000) time = Math.floor(time / 1000);
    else time = Math.floor(time);
    byTime.set(time, [time, close]);
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

export function mergeKlinePoints(...collections) {
  const byTime = new Map();
  for (const points of collections) {
    for (const point of Array.isArray(points) ? points : []) {
      const time = Number(point?.[0]);
      const close = Number(point?.[1]);
      if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
      byTime.set(Math.floor(time), [Math.floor(time), close]);
    }
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

export function downsampleKlinePoints(points, limit = 56) {
  if (!Array.isArray(points) || points.length <= limit) return points || [];
  const result = [points[0]];
  const lastIndex = points.length - 1;
  for (let index = 1; index < limit - 1; index += 1) {
    result.push(points[Math.round((index * lastIndex) / (limit - 1))]);
  }
  result.push(points[lastIndex]);
  return result;
}

export function buildLifetimeTrend(points, options) {
  const normalized = mergeKlinePoints(points);
  if (normalized.length < 2) return { status: "unavailable", reason: "insufficient_kline" };
  const first = normalized[0][1];
  const last = normalized.at(-1)[1];
  return {
    status: "ready",
    from: options.createdAt,
    to: options.scannedAt,
    updatedAt: options.updatedAt,
    resolution: options.resolution,
    changePct: ((last / first) - 1) * 100,
    stale: Boolean(options.stale),
    points: downsampleKlinePoints(normalized, options.pointLimit || 56)
  };
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  async function run() {
    while (queue.length) await worker(queue.shift());
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

function transient(error) {
  return /ConnectTimeout|Connect Timeout|ECONNRESET|fetch failed/i.test(String(error?.stderr || error?.stdout || error?.message || error));
}

async function fetchKline(gmgn, args) {
  try {
    return await gmgn(args);
  } catch (error) {
    if (!transient(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return gmgn(args);
  }
}

export async function enrichLifetimeTrends(candidates, selectedKeys, options) {
  const {
    gmgn,
    store,
    now = Math.floor(Date.now() / 1000),
    concurrency = 3,
    cacheSeconds = 240,
    pointLimit = 56,
    notices = []
  } = options;
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const keys = [...new Set(selectedKeys)].filter((key) => byKey.has(key));
  let ready = 0;
  let failed = 0;

  await mapLimit(keys, concurrency, async (key) => {
    const candidate = byKey.get(key);
    const createdAt = Number(candidate.creationTimestamp);
    if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now + 300 || !isValidAddress(candidate.chain, candidate.address)) {
      candidate.lifetimeTrend = { status: "unavailable", reason: "missing_creation_time" };
      failed += 1;
      return;
    }

    const resolution = lifetimeResolution(createdAt, now);
    const interval = resolutionSeconds[resolution];
    const cached = store.getKlineCache(key);
    const reusable = cached?.resolution === resolution && Array.isArray(cached.points);
    if (reusable && now - cached.checkedAt < cacheSeconds) {
      candidate.lifetimeTrend = buildLifetimeTrend(cached.points, {
        createdAt,
        scannedAt: now,
        updatedAt: cached.checkedAt,
        resolution,
        pointLimit
      });
      ready += Number(candidate.lifetimeTrend.status === "ready");
      failed += Number(candidate.lifetimeTrend.status !== "ready");
      return;
    }

    const from = reusable && cached.points.length
      ? Math.max(createdAt, cached.toTs - interval)
      : createdAt;
    try {
      const result = await fetchKline(gmgn, [
        "market", "kline",
        "--chain", candidate.chain,
        "--address", candidate.address,
        "--resolution", resolution,
        "--from", String(Math.floor(from)),
        "--to", String(now),
        "--raw"
      ]);
      const fresh = parseKlinePoints(result.data);
      const points = mergeKlinePoints(reusable ? cached.points : [], fresh)
        .filter((point) => point[0] >= createdAt - interval && point[0] <= now + interval);
      store.putKlineCache(key, resolution, createdAt, now, points, null, now);
      candidate.lifetimeTrend = buildLifetimeTrend(points, {
        createdAt,
        scannedAt: now,
        updatedAt: now,
        resolution,
        pointLimit
      });
      ready += Number(candidate.lifetimeTrend.status === "ready");
      failed += Number(candidate.lifetimeTrend.status !== "ready");
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      if (reusable && cached.points.length >= 2) {
        store.putKlineCache(key, resolution, createdAt, cached.toTs, cached.points, message, now);
        candidate.lifetimeTrend = buildLifetimeTrend(cached.points, {
          createdAt,
          scannedAt: now,
          updatedAt: cached.checkedAt,
          resolution,
          pointLimit,
          stale: true
        });
        ready += 1;
      } else {
        store.putKlineCache(key, resolution, createdAt, now, [], message, now);
        candidate.lifetimeTrend = { status: "unavailable", reason: "kline_error" };
        failed += 1;
      }
      notices.push(`${candidate.chain}/${candidate.symbol}: 创建以来 K 线暂时不可用`);
    }
  });

  return { selected: keys.length, ready, failed };
}
