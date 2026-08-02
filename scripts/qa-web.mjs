import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.MEME_RADAR_URL || "http://127.0.0.1:8787";
const launchOptions = { headless: true };
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOptions);

async function desktopQa() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await context.newPage();
  await context.route("https://gmgn.ai/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>GMGN token</title>"
  }));
  const pageErrors = [];
  let scanRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/scan") scanRequests += 1;
  });
  await page.goto(`${url}/discovery`, { waitUntil: "networkidle" });
  if (await page.locator("tbody tr").count() === 0) await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.locator("tbody tr").first().waitFor({ timeout: 15_000 });

  assert.equal(await page.title(), "猎星榜 · Meme Radar");
  assert.equal((await page.locator("h1").textContent()).trim(), "猎星榜");
  assert.equal(await page.locator('.page-nav a[aria-current="page"]').textContent().then((text) => text.trim().slice(0, 3)), "猎星榜");
  assert.ok(await page.getByRole("columnheader", { name: "持币地址" }).isVisible());
  assert.ok(await page.getByRole("columnheader", { name: "创建走势" }).isVisible());
  const initialRows = await page.locator("tbody tr").count();
  assert.ok(initialRows > 0, "重点列表应至少包含一个候选");

  const symbol = (await page.locator("tbody tr").first().locator(".token-cell strong").textContent()).trim();
  await page.locator("tbody tr").first().click();
  assert.equal((await page.locator(".inspector h2").textContent()).trim(), symbol);
  assert.ok(await page.getByText("验证与历史置信度").isVisible());
  assert.ok(await page.getByText("Top100 筹码结构").isVisible());
  assert.ok(await page.locator(".metric-grid").getByText("安全分").isVisible());

  const addWatch = page.getByRole("button", { name: "加入收藏" });
  const wasWatched = await addWatch.count() === 0;
  if (!wasWatched) {
    await addWatch.click();
    await page.getByRole("button", { name: "取消收藏" }).waitFor();
    await page.getByRole("link", { name: /验金榜/ }).click();
    await page.waitForLoadState("networkidle");
    assert.equal(new URL(page.url()).pathname, "/verified");
    assert.equal((await page.locator("h1").textContent()).trim(), "验金榜");
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    assert.ok(await page.locator("tbody tr").filter({ hasText: symbol }).count() >= 1, "收藏列表应立即显示代币");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: symbol }).first().waitFor();
    await page.getByRole("button", { name: "取消收藏" }).waitFor();
    await page.getByRole("button", { name: "取消收藏" }).click();
    await page.getByRole("link", { name: /猎星榜/ }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.locator("tbody tr").first().waitFor();
    await page.locator("tbody tr").first().click();
  } else {
    await page.getByRole("link", { name: /验金榜/ }).click();
    await page.waitForLoadState("networkidle");
    assert.equal((await page.locator("h1").textContent()).trim(), "验金榜");
    await page.getByRole("link", { name: /猎星榜/ }).click();
    await page.waitForLoadState("networkidle");
  }

  const firstTokenLink = page.locator("tbody tr").first().locator(".gmgn-token-link");
  const firstChain = (await page.locator("tbody tr").first().locator(".chain").textContent()).trim().toLowerCase();
  const firstAddress = await page.locator("tbody tr").first().locator(".token-name").getAttribute("title");
  const expectedGmgnUrl = `https://gmgn.ai/${firstChain}/token/${encodeURIComponent(firstAddress)}`;
  const expectedTwitterSearch = `https://x.com/search?q=${encodeURIComponent(firstAddress)}&src=typed_query&f=live`;
  assert.equal(await firstTokenLink.getAttribute("href"), expectedGmgnUrl);
  assert.equal(await firstTokenLink.getAttribute("target"), "_blank");
  assert.equal(await page.locator("tbody tr").first().locator(".twitter-contract-search").getAttribute("href"), expectedTwitterSearch);
  assert.equal(await page.locator("tbody tr").first().locator(".twitter-contract-search").getAttribute("target"), "_blank");
  assert.equal(await page.locator(".gmgn-web-action").getAttribute("href"), expectedGmgnUrl);
  const twitterAction = page.locator(".twitter-action");
  if (await twitterAction.count()) {
    assert.match(await twitterAction.getAttribute("href"), /^https:\/\/(?:x\.com|(?:www\.|mobile\.)?twitter\.com)\//);
    assert.equal(await twitterAction.getAttribute("target"), "_blank");
  }
  const popupPromise = page.waitForEvent("popup");
  await firstTokenLink.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  assert.equal(popup.url(), expectedGmgnUrl);
  await popup.close();

  const chainSelect = page.locator(".select-control select").nth(0);
  await chainSelect.selectOption("bsc");
  const visibleChains = await page.locator("tbody tr .chain").allTextContents();
  assert.ok(visibleChains.every((chain) => chain === "BSC"), "BSC 筛选应排除其他链");

  const search = page.locator(".search-control input");
  const firstBscSymbol = (await page.locator("tbody tr").first().locator(".token-cell strong").textContent()).trim();
  await search.fill(firstBscSymbol);
  assert.ok(await page.locator("tbody tr").count() >= 1, "关键词筛选应保留匹配行");
  await search.fill("");
  await chainSelect.selectOption("all");
  const createdSelect = page.locator(".select-control-created select");
  await createdSelect.selectOption("604800");
  await createdSelect.selectOption("all");
  assert.equal(scanRequests, 0, "切换筛选不应触发全量扫描");
  assert.match(await page.locator("tbody tr").first().locator(".market-cap").getAttribute("class"), /market-cap-(micro|small|medium|large|unknown)/);
  assert.ok(await page.locator("tbody tr").first().locator(".lifetime-trend").isVisible());

  const copyButton = page.getByRole("button", { name: "复制合约地址" });
  await copyButton.click();
  await page.waitForTimeout(150);
  assert.match(await copyButton.textContent(), /已复制/);

  await page.getByRole("button", { name: "重点", exact: true }).click();
  await page.locator("tbody tr").first().waitFor();
  await page.locator("tbody tr").first().click();
  await page.screenshot({ path: path.join(root, "output", "web-dashboard-desktop.png"), fullPage: true });

  const scanButton = page.getByRole("button", { name: /立即扫描|扫描中/ });
  if (await scanButton.isEnabled()) await scanButton.click();
  await page.waitForTimeout(250);
  assert.match(await scanButton.textContent(), /扫描中/);
  assert.deepEqual(pageErrors, [], "桌面页面不应出现运行时错误");
  await context.close();
  return { initialRows, selectedSymbol: symbol };
}

async function mobileQa() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await context.newPage();
  await page.goto(`${url}/verified`, { waitUntil: "networkidle" });
  if (await page.locator("tbody tr").count() === 0) await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.locator("tbody tr").first().waitFor({ timeout: 15_000 });
  assert.ok((await page.locator("body").evaluate((body) => body.scrollWidth)) <= 390, "页面主体不应横向溢出");
  assert.ok(await page.locator(".table-region").isVisible());
  assert.ok(await page.locator(".inspector").isVisible());
  assert.equal((await page.locator("h1").textContent()).trim(), "验金榜");
  assert.ok(await page.getByRole("link", { name: /猎星榜/ }).isVisible());
  assert.ok(await page.getByRole("button", { name: /加入收藏|取消收藏/ }).isVisible());
  assert.ok(await page.locator(".mobile-token-card").first().locator(".lifetime-trend").isVisible());
  assert.ok(await page.locator(".mobile-token-card").first().locator(".market-cap").isVisible());
  assert.ok(await page.locator(".mobile-token-card").first().locator(".twitter-contract-search").isVisible());
  assert.match(await page.locator(".gmgn-app-action").getAttribute("href"), /^intent:\/\/gmgn\.ai\//);
  assert.match(await page.locator(".mobile-gmgn-app-link").first().getAttribute("href"), /package=com\.gmgn\.app/);
  assert.match(await page.locator(".mobile-gmgn-web-link").first().getAttribute("href"), /^https:\/\/gmgn\.ai\//);
  await page.screenshot({ path: path.join(root, "output", "web-dashboard-mobile.png"), fullPage: true });
  await context.close();
}

try {
  const desktop = await desktopQa();
  await mobileQa();
  console.log(JSON.stringify({ ok: true, ...desktop, desktop: "output/web-dashboard-desktop.png", mobile: "output/web-dashboard-mobile.png" }));
} finally {
  await browser.close();
}
