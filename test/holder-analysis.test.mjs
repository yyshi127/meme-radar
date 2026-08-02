import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHolders } from "../src/holder-analysis.mjs";

function holder(address, percentage, extra = {}) {
  return {
    address,
    addr_type: 0,
    amount_percentage: percentage,
    maker_token_tags: [],
    ...extra
  };
}

test("Top100 分析识别 bundler 与同源关联钱包，并排除交易所充值", () => {
  const payload = {
    list: [
      holder("bundler-1", 0.12, { maker_token_tags: ["bundler"], native_transfer: { from_address: "fund-a", name: "private" } }),
      holder("related-2", 0.09, { native_transfer: { from_address: "fund-a", name: "private" } }),
      holder("exchange-1", 0.08, { native_transfer: { from_address: "binance-hot", name: "Binance Hot Wallet" } }),
      holder("exchange-2", 0.07, { native_transfer: { from_address: "binance-hot", name: "Binance Hot Wallet" } }),
      holder("normal", 0.05)
    ]
  };

  const result = analyzeHolders(payload);
  assert.equal(result.status, "verified");
  assert.equal(result.bundlerRate, 0.12);
  assert.equal(result.relatedRate, 0.21);
  assert.equal(result.sameSourceGroupCount, 1);
  assert.equal(result.largestWalletRate, 0.12);
});

test("Top100 分析识别 Dev 向仍在榜钱包转移筹码", () => {
  const payload = {
    list: [
      holder("dev", 0.03, { maker_token_tags: ["creator"], token_transfer_out: { address: "puppet" } }),
      holder("puppet", 0.11),
      holder("normal", 0.04)
    ]
  };

  assert.equal(analyzeHolders(payload).devSockPuppet, true);
});

test("当前 KOL 名单排除已清仓钱包并按当前持仓计算加权成本", () => {
  const payload = { list: [holder("normal", 0.05)] };
  const kolPayload = {
    list: [
      holder("holding-kol-1", 0.012, { balance: 100, avg_cost: 2, tags: ["kol"], name: "Alpha", buy_tx_count_cur: 2, sell_tx_count_cur: 1 }),
      holder("holding-kol-2", 0.02, { balance: 300, avg_cost: 4, tags: ["kol"], name: "Beta" }),
      holder("transfer-kol", 0.01, { balance: 100, avg_cost: 0, tags: ["kol"], name: "Transfer" }),
      holder("exited-kol", 0, { balance: 0, tags: ["kol"], name: "Exited", buy_tx_count_cur: 1, sell_tx_count_cur: 1 })
    ]
  };

  const result = analyzeHolders(payload, { kolPayload });
  assert.equal(result.analysisVersion, 3);
  assert.equal(result.currentKolHolderCount, 3);
  assert.equal(result.currentKolHolderRate, 0.042);
  assert.equal(result.currentKolAverageCost, 3.5);
  assert.equal(result.currentKolCostCoverage, 0.8);
  assert.equal(result.currentKolHolders.find((item) => item.name === "Alpha").averageCost, 2);
  assert.equal(result.currentKolCoverage, "all-tagged");
});
