import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let cachedCommand;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function gmgnRequestWeight(args) {
  const [group, action] = args;
  const weights = {
    market: { trending: 1, "hot-searches": 3, trenches: 3, signal: 3, kline: 2 },
    token: { info: 1, security: 1, pool: 1, holders: 5, traders: 5 },
    track: { "follow-tokens": 3, "follow-token-groups": 1, "follow-wallet": 3, kol: 1, smartmoney: 1 },
    portfolio: { info: 1, holdings: 5, activity: 3, stats: 3, "token-balance": 1, "created-tokens": 2 }
  };
  return weights[group]?.[action] ?? 3;
}

function epochMilliseconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 10_000_000_000 ? Math.floor(parsed) : Math.floor(parsed * 1000);
}

export function parseRateLimitReset(detail, now = Date.now()) {
  const text = String(detail || "");
  const epoch = text.match(/(?:reset_at|x-ratelimit-reset)[\s"':=]+(\d{10,13})/i);
  if (epoch) return epochMilliseconds(epoch[1]);

  const dated = text.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*GMT([+-]\d{2}:?\d{2})/i);
  if (dated) {
    const offset = dated[3].includes(":") ? dated[3] : `${dated[3].slice(0, 3)}:${dated[3].slice(3)}`;
    const parsed = Date.parse(`${dated[1]}T${dated[2]}${offset}`);
    if (Number.isFinite(parsed)) return parsed;
  }

  const remaining = text.match(/~\s*(\d+)s\s+remaining/i);
  if (remaining) return now + Number(remaining[1]) * 1000;
  return null;
}

export class GmgnRateLimitError extends Error {
  constructor(retryAt, upstream = false) {
    const retryIso = new Date(retryAt).toISOString();
    super(`GMGN 限流冷却中，${retryIso} 后再试`);
    this.name = "GmgnRateLimitError";
    this.code = upstream ? "GMGN_RATE_LIMITED" : "GMGN_RATE_LIMIT_OPEN";
    this.retryAt = retryIso;
  }
}

export function isGmgnRateLimitError(error) {
  return error instanceof GmgnRateLimitError || /^GMGN_RATE_LIMIT/.test(String(error?.code || ""));
}

function createRequestGate(options = {}) {
  const ratePerSecond = positiveNumber(options.ratePerSecond, 8);
  const capacity = Math.max(5, positiveNumber(options.capacity, 8));
  const maxConcurrency = Math.max(1, Math.floor(positiveNumber(options.maxConcurrency, 2)));
  const now = options.now || Date.now;
  const sleep = options.sleep || delay;
  let tokens = capacity;
  let updatedAt = now();
  let active = 0;
  let blockedUntil = 0;
  let reservationTail = Promise.resolve();
  const slotWaiters = [];

  function status() {
    const blocked = blockedUntil > now();
    return {
      blocked,
      retryAt: blocked ? new Date(blockedUntil).toISOString() : null,
      ratePerSecond,
      capacity,
      maxConcurrency
    };
  }

  function block(retryAt) {
    blockedUntil = Math.max(blockedUntil, Number(retryAt) || 0);
  }

  async function takeSlot() {
    if (active >= maxConcurrency) await new Promise((resolve) => slotWaiters.push(resolve));
    active += 1;
  }

  function releaseSlot() {
    active -= 1;
    slotWaiters.shift()?.();
  }

  function refill() {
    const current = now();
    tokens = Math.min(capacity, tokens + Math.max(0, current - updatedAt) * ratePerSecond / 1000);
    updatedAt = current;
  }

  async function reserve(weight) {
    const amount = Math.min(capacity, Math.max(1, Number(weight) || 1));
    const reservation = reservationTail.then(async () => {
      if (blockedUntil > now()) throw new GmgnRateLimitError(blockedUntil);
      refill();
      if (tokens < amount) {
        await sleep(Math.ceil((amount - tokens) * 1000 / ratePerSecond));
        if (blockedUntil > now()) throw new GmgnRateLimitError(blockedUntil);
        refill();
      }
      tokens = Math.max(0, tokens - amount);
    });
    reservationTail = reservation.catch(() => {});
    return reservation;
  }

  async function run(weight, task) {
    await takeSlot();
    try {
      if (blockedUntil > now()) throw new GmgnRateLimitError(blockedUntil);
      await reserve(weight);
      if (blockedUntil > now()) throw new GmgnRateLimitError(blockedUntil);
      return await task();
    } finally {
      releaseSlot();
    }
  }

  return { block, run, status };
}

async function command() {
  if (cachedCommand) return cachedCommand;
  if (process.platform === "win32") {
    const entry = process.env.GMGN_CLI_JS || path.join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "gmgn-cli",
      "dist",
      "index.js"
    );
    await access(entry);
    cachedCommand = { file: process.execPath, prefix: [entry] };
  } else {
    cachedCommand = { file: process.env.GMGN_CLI || "gmgn-cli", prefix: [] };
  }
  return cachedCommand;
}

async function executeCli(args, timeout) {
  const runner = await command();
  return execFileAsync(runner.file, [...runner.prefix, ...args], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    encoding: "utf8"
  });
}

export function createGmgnClient(options = {}) {
  const execute = options.execute || executeCli;
  const now = options.now || Date.now;
  const gate = createRequestGate({
    ratePerSecond: options.ratePerSecond,
    capacity: options.capacity,
    maxConcurrency: options.maxConcurrency,
    now,
    sleep: options.sleep
  });

  const request = async (args, timeout = 75_000) => gate.run(gmgnRequestWeight(args), async () => {
    try {
      const { stdout, stderr = "" } = await execute(args, timeout);
      const notices = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const parsed = JSON.parse(stdout.trim());
      if (parsed?.code && parsed.code !== 0) throw new Error(parsed.message || `GMGN code ${parsed.code}`);
      return { data: parsed, notices };
    } catch (error) {
      const detail = String(error?.stderr || error?.stdout || error?.message || error);
      if (/\b429\b|RATE_LIMIT_(?:BANNED|EXCEEDED)/i.test(detail)) {
        const retryAt = parseRateLimitReset(detail, now()) || now() + 5 * 60 * 1000;
        gate.block(retryAt);
        throw new GmgnRateLimitError(retryAt, true);
      }
      throw error;
    }
  });
  request.status = gate.status;
  return request;
}

const defaultGmgn = createGmgnClient({
  ratePerSecond: positiveNumber(process.env.GMGN_RATE_PER_SECOND, 8),
  capacity: positiveNumber(process.env.GMGN_RATE_BURST, 8),
  maxConcurrency: positiveNumber(process.env.GMGN_MAX_CONCURRENCY, 2)
});

export const gmgn = defaultGmgn;
export const getGmgnRateLimitStatus = () => defaultGmgn.status();

export async function checkConfig() {
  const runner = await command();
  await execFileAsync(runner.file, [...runner.prefix, "config", "--check"], {
    cwd: process.cwd(),
    timeout: 15_000,
    windowsHide: true
  });
}
