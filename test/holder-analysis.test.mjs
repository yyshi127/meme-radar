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

test("开发者标签查询同时保留已清仓钱包、身份标签与马甲转移", () => {
  const payload = {
    list: [
      holder("puppet", 0.11, { balance: 1000 }),
      holder("normal", 0.04, { balance: 400 })
    ]
  };
  const devPayload = {
    list: [
      holder("creator", 0, {
        balance: 0,
        maker_token_tags: ["creator", "dev_team"],
        tags: ["renowned"],
        twitter_name: "Known Founder",
        realized_profit: 12000,
        token_transfer_out: { address: "puppet" }
      }),
      holder("team", 0.025, {
        balance: 250,
        maker_token_tags: ["dev_team"],
        avg_cost: 2,
        unrealized_pnl: 0.5
      })
    ]
  };

  const result = analyzeHolders(payload, { devPayload });
  assert.equal(result.analysisVersion, 4);
  assert.equal(result.devWalletCount, 2);
  assert.equal(result.devActiveWalletCount, 1);
  assert.equal(result.devHoldingRate, 0.025);
  assert.equal(result.devRenownedWalletCount, 1);
  assert.equal(result.devRealizedProfit, 12000);
  assert.equal(result.developerCoverage, "all-tagged");
  assert.equal(result.developerWallets[0].role, "creator");
  assert.equal(result.developerWallets[0].isHolding, false);
  assert.equal(result.developerWallets[0].isRenowned, true);
  assert.equal(result.developerWallets[0].transferredToTop100, true);
  assert.equal(result.devSockPuppet, true);
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
  assert.equal(result.analysisVersion, 4);
  assert.equal(result.currentKolHolderCount, 3);
  assert.equal(result.currentKolHolderRate, 0.042);
  assert.equal(result.currentKolAverageCost, 3.5);
  assert.equal(result.currentKolCostCoverage, 0.8);
  assert.equal(result.currentKolHolders.find((item) => item.name === "Alpha").averageCost, 2);
  assert.equal(result.currentKolCoverage, "all-tagged");
});
