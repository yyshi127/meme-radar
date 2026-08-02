import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let cachedCommand;

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

export async function gmgn(args, timeout = 75_000) {
  const runner = await command();
  const { stdout, stderr } = await execFileAsync(runner.file, [...runner.prefix, ...args], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    encoding: "utf8"
  });
  const notices = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = JSON.parse(stdout.trim());
  if (parsed?.code && parsed.code !== 0) throw new Error(parsed.message || `GMGN code ${parsed.code}`);
  return { data: parsed, notices };
}

export async function checkConfig() {
  const runner = await command();
  await execFileAsync(runner.file, [...runner.prefix, "config", "--check"], {
    cwd: process.cwd(),
    timeout: 15_000,
    windowsHide: true
  });
}
