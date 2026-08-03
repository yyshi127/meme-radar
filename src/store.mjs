import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createRadarStore(file = path.join(root, "data", "radar.sqlite")) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      key TEXT PRIMARY KEY,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      hit_count INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holder_cache (
      key TEXT PRIMARY KEY,
      checked_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS kline_cache (
      key TEXT PRIMARY KEY,
      checked_at INTEGER NOT NULL,
      resolution TEXT NOT NULL,
      from_ts INTEGER NOT NULL,
      to_ts INTEGER NOT NULL,
      points_json TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS developer_history_cache (
      key TEXT PRIMARY KEY,
      checked_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS same_name_cache (
      key TEXT PRIMARY KEY,
      checked_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS tracked_tokens (
      key TEXT PRIMARY KEY,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      initial_price REAL,
      initial_market_cap REAL,
      initial_score INTEGER,
      initial_priority TEXT,
      last_sample_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      key TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      price REAL,
      market_cap REAL,
      liquidity REAL,
      score INTEGER,
      priority TEXT,
      snapshot_json TEXT,
      PRIMARY KEY (key, observed_at)
    );
    CREATE TABLE IF NOT EXISTS wallet_signals (
      wallet TEXT NOT NULL,
      kind TEXT NOT NULL,
      token_key TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      PRIMARY KEY (wallet, kind, token_key)
    );
    CREATE INDEX IF NOT EXISTS idx_observations_key_time ON observations(key, observed_at);
    CREATE INDEX IF NOT EXISTS idx_tracked_last_sample ON tracked_tokens(last_sample_at);
    CREATE INDEX IF NOT EXISTS idx_wallet_signals_wallet ON wallet_signals(wallet, kind);
  `);

  const watchlistColumns = new Set(db.prepare("PRAGMA table_info(watchlist)").all().map((column) => column.name));
  if (!watchlistColumns.has("hit_count")) {
    db.exec("ALTER TABLE watchlist ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0");
  }

  const statements = {
    putWatch: db.prepare(`
      INSERT INTO watchlist(key, chain, address, added_at, last_seen_at, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        chain=excluded.chain, address=excluded.address,
        last_seen_at=excluded.last_seen_at, snapshot_json=excluded.snapshot_json
    `),
    deleteWatch: db.prepare("DELETE FROM watchlist WHERE key=?"),
    listWatch: db.prepare("SELECT * FROM watchlist ORDER BY added_at DESC"),
    watchKeys: db.prepare("SELECT key FROM watchlist"),
    getWatchSnapshot: db.prepare("SELECT snapshot_json FROM watchlist WHERE key=?"),
    updateWatch: db.prepare("UPDATE watchlist SET last_seen_at=?, snapshot_json=?, hit_count=hit_count+1 WHERE key=?"),
    updateWatchMarket: db.prepare("UPDATE watchlist SET snapshot_json=? WHERE key=?"),
    getHolderCache: db.prepare("SELECT * FROM holder_cache WHERE key=?"),
    putHolderCache: db.prepare(`
      INSERT INTO holder_cache(key, checked_at, status, payload_json, error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at, status=excluded.status,
        payload_json=excluded.payload_json, error=excluded.error
    `),
    getKlineCache: db.prepare("SELECT * FROM kline_cache WHERE key=?"),
    putKlineCache: db.prepare(`
      INSERT INTO kline_cache(key, checked_at, resolution, from_ts, to_ts, points_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at, resolution=excluded.resolution,
        from_ts=excluded.from_ts, to_ts=excluded.to_ts, points_json=excluded.points_json,
        error=excluded.error
    `),
    getDeveloperHistoryCache: db.prepare("SELECT * FROM developer_history_cache WHERE key=?"),
    putDeveloperHistoryCache: db.prepare(`
      INSERT INTO developer_history_cache(key, checked_at, status, payload_json, error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at, status=excluded.status,
        payload_json=excluded.payload_json, error=excluded.error
    `),
    getSameNameCache: db.prepare("SELECT * FROM same_name_cache WHERE key=?"),
    putSameNameCache: db.prepare(`
      INSERT INTO same_name_cache(key, checked_at, status, payload_json, error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET checked_at=excluded.checked_at, status=excluded.status,
        payload_json=excluded.payload_json, error=excluded.error
    `),
    putTracked: db.prepare(`
      INSERT INTO tracked_tokens(key, chain, address, first_seen, last_seen, initial_price,
        initial_market_cap, initial_score, initial_priority, last_sample_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET last_seen=excluded.last_seen, last_sample_at=excluded.last_sample_at
    `),
    putObservation: db.prepare(`
      INSERT OR REPLACE INTO observations(key, observed_at, price, market_cap, liquidity, score, priority, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    putWalletSignal: db.prepare("INSERT OR IGNORE INTO wallet_signals(wallet, kind, token_key, first_seen) VALUES (?, ?, ?, ?)"),
    tracked: db.prepare("SELECT * FROM tracked_tokens"),
    observations: db.prepare("SELECT * FROM observations WHERE key=? ORDER BY observed_at"),
    dueTracked: db.prepare("SELECT * FROM tracked_tokens WHERE last_sample_at<=? AND first_seen>=? ORDER BY last_sample_at LIMIT ?"),
    walletSignals: db.prepare("SELECT * FROM wallet_signals")
  };

  function watchKey(chain, address) {
    return `${String(chain).toLowerCase()}:${String(address).toLowerCase()}`;
  }

  function addWatch(candidate) {
    const now = Math.floor(Date.now() / 1000);
    const key = watchKey(candidate.chain, candidate.address);
    statements.putWatch.run(key, candidate.chain, candidate.address, now, now, JSON.stringify(candidate));
    return key;
  }

  function removeWatch(chain, address) {
    return statements.deleteWatch.run(watchKey(chain, address)).changes > 0;
  }

  function listWatchlist(currentCandidates = []) {
    const current = new Map(currentCandidates.map((candidate) => [candidate.key, candidate]));
    return statements.listWatch.all().map((row) => {
      const snapshot = current.get(row.key) || parseJson(row.snapshot_json, {});
      return {
        key: row.key,
        chain: row.chain,
        address: row.address,
        addedAt: new Date(row.added_at * 1000).toISOString(),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at * 1000).toISOString() : null,
        hitCount: Number(row.hit_count || 0),
        isLive: current.has(row.key),
        snapshot: {
          ...snapshot,
          watched: true,
          isLive: current.has(row.key),
          watchHitCount: Number(row.hit_count || 0)
        }
      };
    });
  }

  function watchedKeys() {
    return new Set(statements.watchKeys.all().map((row) => row.key));
  }

  function syncWatchSnapshots(candidates, now = Math.floor(Date.now() / 1000)) {
    const watched = watchedKeys();
    const synced = new Set();
    for (const candidate of candidates) {
      if (!watched.has(candidate.key) || synced.has(candidate.key) || !["ALERT", "WATCH"].includes(candidate.priority)) continue;
      statements.updateWatch.run(now, JSON.stringify(candidate), candidate.key);
      synced.add(candidate.key);
    }
  }

  function updateWatchMarket(candidate, now = Math.floor(Date.now() / 1000)) {
    const key = watchKey(candidate.chain, candidate.address);
    const row = statements.getWatchSnapshot.get(key);
    if (!row) return false;
    const snapshot = parseJson(row.snapshot_json, {});
    let changed = false;
    for (const field of ["price", "marketCap", "liquidity"]) {
      if (!Number.isFinite(candidate[field])) continue;
      snapshot[field] = candidate[field];
      changed = true;
    }
    if (!changed) return false;
    snapshot.marketUpdatedAt = new Date(now * 1000).toISOString();
    return statements.updateWatchMarket.run(JSON.stringify(snapshot), key).changes > 0;
  }

  function getHolderCache(key, maxAgeSeconds) {
    const row = statements.getHolderCache.get(key);
    if (!row || Math.floor(Date.now() / 1000) - row.checked_at > maxAgeSeconds) return null;
    return {
      status: row.status,
      checkedAt: row.checked_at,
      payload: parseJson(row.payload_json),
      error: row.error || null
    };
  }

  function putHolderCache(key, status, payload = null, error = null) {
    statements.putHolderCache.run(key, Math.floor(Date.now() / 1000), status, payload ? JSON.stringify(payload) : null, error);
  }

  function getKlineCache(key) {
    const row = statements.getKlineCache.get(key);
    if (!row) return null;
    return {
      checkedAt: Number(row.checked_at),
      resolution: row.resolution,
      fromTs: Number(row.from_ts),
      toTs: Number(row.to_ts),
      points: parseJson(row.points_json, []),
      error: row.error || null
    };
  }

  function putKlineCache(key, resolution, fromTs, toTs, points, error = null, checkedAt = Math.floor(Date.now() / 1000)) {
    statements.putKlineCache.run(
      key,
      checkedAt,
      resolution,
      fromTs,
      toTs,
      JSON.stringify(points),
      error
    );
  }

  function getDeveloperHistoryCache(key, maxAgeSeconds = Infinity) {
    const row = statements.getDeveloperHistoryCache.get(key);
    if (!row || Math.floor(Date.now() / 1000) - row.checked_at > maxAgeSeconds) return null;
    return {
      status: row.status,
      checkedAt: Number(row.checked_at),
      payload: parseJson(row.payload_json),
      error: row.error || null
    };
  }

  function putDeveloperHistoryCache(key, status, payload = null, error = null) {
    statements.putDeveloperHistoryCache.run(
      key,
      Math.floor(Date.now() / 1000),
      status,
      payload ? JSON.stringify(payload) : null,
      error
    );
  }

  function getSameNameCache(key, maxAgeSeconds = Infinity) {
    const row = statements.getSameNameCache.get(key);
    if (!row || Math.floor(Date.now() / 1000) - row.checked_at > maxAgeSeconds) return null;
    return {
      status: row.status,
      checkedAt: Number(row.checked_at),
      payload: parseJson(row.payload_json),
      error: row.error || null
    };
  }

  function putSameNameCache(key, status, payload = null, error = null) {
    statements.putSameNameCache.run(
      key,
      Math.floor(Date.now() / 1000),
      status,
      payload ? JSON.stringify(payload) : null,
      error
    );
  }

  function recordCandidates(candidates, now = Math.floor(Date.now() / 1000)) {
    const watched = watchedKeys();
    const observedAt = Math.floor(now / 60) * 60;
    db.exec("BEGIN");
    try {
      for (const candidate of candidates) {
        if (!["ALERT", "WATCH"].includes(candidate.priority) && !watched.has(candidate.key)) continue;
        const firstSeen = Number(candidate.firstSeen || now);
        const price = finite(candidate.price);
        statements.putTracked.run(
          candidate.key, candidate.chain, candidate.address, firstSeen, now, price,
          finite(candidate.marketCap), candidate.score, candidate.priority, now
        );
        statements.putObservation.run(
          candidate.key, observedAt, price, finite(candidate.marketCap), finite(candidate.liquidity),
          candidate.score, candidate.priority, JSON.stringify(candidate)
        );
        for (const wallet of candidate.smartMakers || []) statements.putWalletSignal.run(String(wallet).toLowerCase(), "smart", candidate.key, firstSeen);
        for (const wallet of candidate.kolMakers || []) statements.putWalletSignal.run(String(wallet).toLowerCase(), "kol", candidate.key, firstSeen);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function recordExternalObservation(token, now = Math.floor(Date.now() / 1000)) {
    const key = watchKey(token.chain, token.address);
    const observedAt = Math.floor(now / 60) * 60;
    statements.putObservation.run(
      key, observedAt, finite(token.price), finite(token.marketCap), finite(token.liquidity),
      null, "TRACKED", JSON.stringify(token)
    );
    db.prepare("UPDATE tracked_tokens SET last_seen=?, last_sample_at=? WHERE key=?").run(now, now, key);
  }

  function dueTrackedTokens(now, currentKeys, limit = 6) {
    const cutoff = now - 24 * 3600;
    const threshold = now - 15 * 60;
    return statements.dueTracked.all(threshold, cutoff, Math.max(limit * 3, limit))
      .filter((row) => !currentKeys.has(row.key))
      .slice(0, limit);
  }

  function outcomeFor(row) {
    const observations = statements.observations.all(row.key).filter((item) => finite(item.price) > 0);
    const initialPrice = finite(row.initial_price);
    if (!initialPrice || observations.length === 0) return null;
    const prices = observations.map((item) => Number(item.price));
    const latest = observations.at(-1);
    const peakReturnPct = (Math.max(...prices) / initialPrice - 1) * 100;
    const maxDrawdownPct = (Math.min(...prices) / initialPrice - 1) * 100;
    const currentReturnPct = (Number(latest.price) / initialPrice - 1) * 100;
    const matured6h = latest.observed_at >= row.first_seen + 6 * 3600;
    return {
      observations: observations.length,
      firstSeen: row.first_seen,
      lastObservedAt: latest.observed_at,
      currentReturnPct,
      peakReturnPct,
      maxDrawdownPct,
      matured6h,
      success6h: matured6h ? peakReturnPct >= 100 && maxDrawdownPct > -40 : null
    };
  }

  function calibrationContext(minSamples = 50) {
    const trackedRows = statements.tracked.all();
    const outcomes = new Map();
    const matured = [];
    for (const row of trackedRows) {
      const outcome = outcomeFor(row);
      if (!outcome) continue;
      outcomes.set(row.key, outcome);
      if (outcome.matured6h) matured.push({ row, outcome });
    }

    const successCount = matured.filter(({ outcome }) => outcome.success6h).length;
    const segments = new Map();
    for (const entry of matured) {
      const bucket = Math.floor(Number(entry.row.initial_score || 0) / 10) * 10;
      const key = `${entry.row.chain}:${bucket}`;
      if (!segments.has(key)) segments.set(key, { samples: 0, successes: 0 });
      const segment = segments.get(key);
      segment.samples += 1;
      if (entry.outcome.success6h) segment.successes += 1;
    }

    const walletResults = new Map();
    for (const signal of statements.walletSignals.all()) {
      const outcome = outcomes.get(signal.token_key);
      if (!outcome?.matured6h) continue;
      const key = `${signal.kind}:${signal.wallet}`;
      if (!walletResults.has(key)) walletResults.set(key, { samples: 0, successes: 0 });
      const result = walletResults.get(key);
      result.samples += 1;
      if (outcome.success6h) result.successes += 1;
    }

    return {
      outcomes,
      segments,
      walletResults,
      report: {
        status: matured.length >= minSamples ? "calibrated" : "collecting",
        definition: "首次发现后 6 小时内最高涨幅≥100%，且样本期最大回撤>-40%",
        tracked: trackedRows.length,
        matured6h: matured.length,
        successes6h: successCount,
        empiricalRate: matured.length >= minSamples ? successCount / matured.length : null,
        minSamples
      }
    };
  }

  function walletReputation(candidate, context) {
    const reputations = [];
    for (const [kind, wallets] of [["smart", candidate.smartMakers || []], ["kol", candidate.kolMakers || []]]) {
      for (const wallet of wallets) {
        const result = context.walletResults.get(`${kind}:${String(wallet).toLowerCase()}`);
        if (result?.samples >= 10) reputations.push({ kind, wallet, ...result, rate: result.successes / result.samples });
      }
    }
    const bonus = reputations.length
      ? Math.max(-6, Math.min(6, Math.round(reputations.reduce((sum, item) => sum + (item.rate - 0.5) * 8, 0) / reputations.length)))
      : 0;
    return { bonus, reputations };
  }

  function decorateCandidates(candidates, context) {
    return candidates.map((candidate) => {
      const history = context.outcomes.get(candidate.key) || null;
      const bucket = Math.floor(Number(candidate.score || 0) / 10) * 10;
      const segment = context.segments.get(`${candidate.chain}:${bucket}`);
      const calibratedProbability = segment && segment.samples >= 20
        ? (segment.successes + 1) / (segment.samples + 2)
        : null;

      const { bonus: walletReputationBonus, reputations } = walletReputation(candidate, context);
      return { ...candidate, history, calibratedProbability, calibrationSamples: segment?.samples || 0, walletReputationBonus };
    });
  }

  return {
    addWatch,
    removeWatch,
    listWatchlist,
    watchedKeys,
    syncWatchSnapshots,
    updateWatchMarket,
    getHolderCache,
    putHolderCache,
    getKlineCache,
    putKlineCache,
    getDeveloperHistoryCache,
    putDeveloperHistoryCache,
    getSameNameCache,
    putSameNameCache,
    recordCandidates,
    recordExternalObservation,
    dueTrackedTokens,
    calibrationContext,
    walletReputation,
    decorateCandidates,
    close: () => db.close()
  };
}

export const radarStore = createRadarStore();
