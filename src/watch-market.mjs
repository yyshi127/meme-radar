import { getCandidate, mergeMarketRow } from "./core.mjs";

function hydrateFromSnapshot(candidate, snapshot = {}) {
  for (const field of ["symbol", "name", "creatorAddress", "price", "marketCap", "liquidity", "developerHistory", "sameNameLeader"]) {
    if (snapshot[field] === null || snapshot[field] === undefined) continue;
    if (candidate[field] === null || candidate[field] === undefined || candidate[field] === "?") candidate[field] = snapshot[field];
  }
}

export async function refreshWatchMarkets(book, options) {
  const { gmgn, store, notices = [] } = options;
  const watched = store.listWatchlist();
  let refreshed = 0;
  const researchEntries = [];

  for (const entry of watched) {
    const candidate = book.get(entry.key) || getCandidate(new Map(), entry.chain, entry.address);
    if (!candidate) {
      notices.push(`${entry.chain}/${entry.address.slice(0, 8)}: 收藏地址格式无效，跳过本轮补全`);
      continue;
    }
    hydrateFromSnapshot(candidate, entry.snapshot);
    researchEntries.push({ candidate, snapshot: entry.snapshot || {} });
    try {
      const result = await gmgn(["token", "info", "--chain", entry.chain, "--address", entry.address, "--raw"]);
      mergeMarketRow(candidate, result.data, "watch-market");
      if (store.updateWatchMarket(candidate)) refreshed += 1;
    } catch {
      notices.push(`${entry.chain}/${entry.snapshot?.symbol || entry.address.slice(0, 8)}: 收藏行情刷新失败，继续显示上次数据`);
    }
  }

  return { refreshed, researchEntries };
}
