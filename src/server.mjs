import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadLatestReport, scan } from "./index.mjs";
import { isValidAddress } from "./core.mjs";
import { radarStore } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "web", "dist");
const host = "127.0.0.1";
const port = Number(process.env.MEME_RADAR_PORT || 8787);
const shouldOpen = process.argv.includes("--open");
const config = await loadConfig();

let activeScan = null;
let latestReport = await loadLatestReport();
let status = {
  scanning: false,
  lastStartedAt: null,
  lastCompletedAt: latestReport?.generatedAt || null,
  lastError: null,
  trigger: null,
  intervalSeconds: config.watchIntervalSeconds
};

function json(response, code, data) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

async function requestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function startScan(trigger) {
  if (activeScan) return activeScan;
  status = { ...status, scanning: true, lastStartedAt: new Date().toISOString(), lastError: null, trigger };
  activeScan = scan(config, { quiet: true })
    .then((result) => {
      latestReport = result;
      status = { ...status, scanning: false, lastCompletedAt: result.generatedAt, lastError: null };
      console.log(`[scan] ${result.candidates.length} candidates, ${result.errors.length} source errors`);
      return result;
    })
    .catch((error) => {
      status = { ...status, scanning: false, lastError: String(error.message || error).slice(0, 500) };
      console.error(`[scan] ${status.lastError}`);
      throw error;
    })
    .finally(() => { activeScan = null; });
  return activeScan;
}

function mime(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  }[extension] || "application/octet-stream";
}

async function staticFile(requestPath, response) {
  const cleanPath = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  let file = path.resolve(publicDir, cleanPath);
  if (!file.startsWith(`${publicDir}${path.sep}`) && file !== publicDir) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not file");
  } catch {
    file = path.join(publicDir, "index.html");
  }
  response.writeHead(200, {
    "Content-Type": mime(file),
    "Cache-Control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === "/api/health" && request.method === "GET") return json(response, 200, { ok: true });
    if (url.pathname === "/api/status" && request.method === "GET") return json(response, 200, status);
    if (url.pathname === "/api/report" && request.method === "GET") {
      if (!latestReport) return json(response, 202, { scanning: status.scanning, message: "首次扫描尚未完成" });
      return json(response, 200, latestReport);
    }
    if (url.pathname === "/api/watchlist" && request.method === "GET") {
      return json(response, 200, { items: radarStore.listWatchlist(latestReport?.candidates || []) });
    }
    if (url.pathname === "/api/watchlist" && request.method === "POST") {
      const body = await requestJson(request);
      const chain = String(body.chain || "").toLowerCase();
      const address = String(body.address || "");
      if (!config.chains.includes(chain) || !isValidAddress(chain, address)) return json(response, 400, { error: "链或合约地址无效" });
      const key = `${chain}:${address.toLowerCase()}`;
      const candidate = latestReport?.candidates?.find((item) => item.key === key);
      if (!candidate) return json(response, 404, { error: "当前候选中没有这个代币" });
      radarStore.addWatch(candidate);
      return json(response, 201, { items: radarStore.listWatchlist(latestReport.candidates) });
    }
    if (url.pathname === "/api/watchlist" && request.method === "DELETE") {
      const chain = String(url.searchParams.get("chain") || "").toLowerCase();
      const address = String(url.searchParams.get("address") || "");
      if (!config.chains.includes(chain) || !isValidAddress(chain, address)) return json(response, 400, { error: "链或合约地址无效" });
      radarStore.removeWatch(chain, address);
      return json(response, 200, { items: radarStore.listWatchlist(latestReport?.candidates || []) });
    }
    if (url.pathname === "/api/scan" && request.method === "POST") {
      const alreadyRunning = Boolean(activeScan);
      startScan("manual").catch(() => {});
      return json(response, 202, { accepted: !alreadyRunning, scanning: true });
    }
    if (url.pathname.startsWith("/api/")) return json(response, 404, { error: "Not found" });
    return staticFile(url.pathname, response);
  } catch (error) {
    return json(response, 500, { error: String(error.message || error).slice(0, 500) });
  }
});

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

await access(path.join(publicDir, "index.html"));
server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`Meme Radar Web: ${url}`);
  if (shouldOpen) openBrowser(url);
  const reportAge = latestReport?.generatedAt ? Date.now() - Date.parse(latestReport.generatedAt) : Infinity;
  if (reportAge >= config.watchIntervalSeconds * 1000) startScan("startup").catch(() => {});
});

setInterval(() => startScan("schedule").catch(() => {}), config.watchIntervalSeconds * 1000).unref();
