import { getCandidate, mergeMarketRow } from "./core.mjs";

export async function refreshWatchMarkets(book, options) {
  const { gmgn, store, notices = [] } = options;
  const watched = store.listWatchlist();
  let refreshed = 0;

  for (const entry of watched) {
    try {
      const result = await gmgn(["token", "info", "--chain", entry.chain, "--address", entry.address, "--raw"]);
      const candidate = book.get(entry.key) || getCandidate(new Map(), entry.chain, entry.address);
      mergeMarketRow(candidate, result.data, "watch-market");
      if (store.updateWatchMarket(candidate)) refreshed += 1;
    } catch {
      notices.push(`${entry.chain}/${entry.snapshot?.symbol || entry.address.slice(0, 8)}: 收藏行情刷新失败，继续显示上次数据`);
    }
  }

  return refreshed;
}
