function rate(holder) {
  const value = Number(holder?.amount_percentage);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function tags(holder) {
  return new Set([...(holder?.maker_token_tags || []), ...(holder?.tags || [])]);
}

function hasTag(holder, name) {
  return tags(holder).has(name);
}

function sumRate(holders) {
  return holders.reduce((total, holder) => total + rate(holder), 0);
}

function holderList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.list) ? payload.list : null;
}

function walletText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

function currentTaggedHolders(payload, fallback, tagNames) {
  const queried = holderList(payload);
  const source = queried ?? fallback.filter((holder) => tagNames.some((tag) => hasTag(holder, tag)));
  const unique = new Map();
  for (const holder of source) {
    const address = String(holder?.address || "");
    if (!address || Number(holder?.addr_type || 0) !== 0 || Number(holder?.balance || 0) <= 0 || rate(holder) <= 0) continue;
    unique.set(address.toLowerCase(), {
      address,
      name: walletText(holder.twitter_name) || walletText(holder.name),
      twitterUsername: walletText(holder.twitter_username),
      amountPercentage: rate(holder),
      usdValue: Number(holder.usd_value || 0),
      buyTxCount: Number(holder.buy_tx_count_cur || 0),
      sellTxCount: Number(holder.sell_tx_count_cur || 0),
      sellAmountPercentage: Number(holder.sell_amount_percentage || 0),
      lastActiveTimestamp: Number(holder.last_active_timestamp || 0)
    });
  }
  return [...unique.values()].sort((a, b) => b.amountPercentage - a.amountPercentage);
}

function looksLikeExchangeFunding(transfer) {
  const name = String(transfer?.name || "").toLowerCase();
  return /binance|okx|bybit|coinbase|kraken|kucoin|gate|mexc|bitget|hot wallet|exchange/.test(name);
}

export function analyzeHolders(payload, options = {}) {
  const holders = Array.isArray(payload) ? payload : payload?.list;
  if (!Array.isArray(holders) || holders.length === 0) throw new Error("Holder 数据为空");

  const windowSeconds = options.windowSeconds || 30 * 60;
  const normal = holders.filter((holder) => Number(holder?.addr_type || 0) === 0);
  const burn = holders.filter((holder) => Number(holder?.addr_type || 0) === 1);
  const dex = holders.filter((holder) => Number(holder?.addr_type || 0) === 2);
  const sortedNormal = [...normal].sort((a, b) => rate(b) - rate(a));

  const bundlers = normal.filter((holder) => hasTag(holder, "bundler"));
  const rats = normal.filter((holder) => hasTag(holder, "rat_trader"));
  const snipers = normal.filter((holder) => hasTag(holder, "sniper"));
  const wash = normal.filter((holder) => hasTag(holder, "wash_trader"));
  const fresh = normal.filter((holder) => hasTag(holder, "fresh_wallet"));
  const airdrop = normal.filter((holder) => Number(holder?.buy_tx_count_cur || 0) === 0 && rate(holder) > 0);
  const devs = normal.filter((holder) => hasTag(holder, "creator") || hasTag(holder, "dev_team"));
  const smartList = holderList(options.smartPayload);
  const kolList = holderList(options.kolPayload);
  const currentSmartHolders = currentTaggedHolders(options.smartPayload, normal, ["smart_degen", "pump_smart"]);
  const currentKolHolders = currentTaggedHolders(options.kolPayload, normal, ["renowned", "kol"]);

  const riskAddresses = new Set([...bundlers, ...rats, ...snipers, ...wash].map((holder) => holder.address));
  const riskWallets = normal.filter((holder) => riskAddresses.has(holder.address));

  const fundingGroups = new Map();
  for (const holder of normal) {
    const transfer = holder?.native_transfer;
    const source = String(transfer?.from_address || "").toLowerCase();
    if (!source || looksLikeExchangeFunding(transfer)) continue;
    if (!fundingGroups.has(source)) fundingGroups.set(source, []);
    fundingGroups.get(source).push(holder);
  }
  const sameSourceGroups = [...fundingGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  const relatedAddresses = new Set(sameSourceGroups.flatMap(([, group]) => group.map((holder) => holder.address)));

  const holdingTimes = normal
    .map((holder) => Number(holder?.start_holding_at || 0))
    .filter((timestamp) => timestamp > 0);
  const launchTime = holdingTimes.length ? Math.min(...holdingTimes) : 0;
  const coordinatedBuckets = new Map();
  for (const holder of fresh) {
    const transfer = holder?.native_transfer;
    const timestamp = Number(transfer?.timestamp || 0);
    if (!timestamp || looksLikeExchangeFunding(transfer)) continue;
    if (launchTime && Math.abs(timestamp - launchTime) > 24 * 3600) continue;
    const bucket = Math.floor(timestamp / windowSeconds) * windowSeconds;
    if (!coordinatedBuckets.has(bucket)) coordinatedBuckets.set(bucket, []);
    coordinatedBuckets.get(bucket).push(holder);
  }
  const coordinatedGroups = [...coordinatedBuckets.entries()]
    .filter(([, group]) => group.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  const coordinatedAddresses = new Set(coordinatedGroups.flatMap(([, group]) => group.map((holder) => holder.address)));

  const holderByAddress = new Map(holders.map((holder) => [String(holder.address || "").toLowerCase(), holder]));
  let devSockPuppet = false;
  for (const dev of devs) {
    const targets = [dev?.token_transfer_out?.address, dev?.token_transfer?.address]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    if (targets.some((target) => target !== String(dev.address || "").toLowerCase() && holderByAddress.has(target))) {
      devSockPuppet = true;
      break;
    }
  }

  const normalRate = sumRate(normal);
  const badAddresses = new Set([...riskAddresses, ...relatedAddresses, ...coordinatedAddresses]);
  const badRate = sumRate(normal.filter((holder) => badAddresses.has(holder.address)));

  return {
    analysisVersion: 2,
    status: "verified",
    checkedAt: new Date().toISOString(),
    sampleSize: holders.length,
    normalHolderCount: normal.length,
    top10Rate: sumRate(sortedNormal.slice(0, 10)),
    top20Rate: sumRate(sortedNormal.slice(0, 20)),
    largestWalletRate: rate(sortedNormal[0]),
    bundlerRate: sumRate(bundlers),
    insiderRate: sumRate(rats),
    sniperRate: sumRate(snipers),
    washRate: sumRate(wash),
    freshRate: sumRate(fresh),
    airdropRate: sumRate(airdrop),
    riskWalletRate: sumRate(riskWallets),
    relatedRate: sumRate(normal.filter((holder) => relatedAddresses.has(holder.address))),
    relatedWalletCount: relatedAddresses.size,
    sameSourceGroupCount: sameSourceGroups.length,
    coordinatedRate: sumRate(normal.filter((holder) => coordinatedAddresses.has(holder.address))),
    coordinatedWalletCount: coordinatedAddresses.size,
    coordinatedGroupCount: coordinatedGroups.length,
    devHoldingRate: sumRate(devs),
    devWalletCount: devs.length,
    devSockPuppet,
    currentSmartHolderCount: currentSmartHolders.length,
    currentSmartHolderRate: currentSmartHolders.reduce((total, holder) => total + holder.amountPercentage, 0),
    currentSmartHolders,
    currentSmartCoverage: smartList === null ? "top100-only" : "all-tagged",
    currentKolHolderCount: currentKolHolders.length,
    currentKolHolderRate: currentKolHolders.reduce((total, holder) => total + holder.amountPercentage, 0),
    currentKolHolders,
    currentKolCoverage: kolList === null ? "top100-only" : "all-tagged",
    burnRate: sumRate(burn),
    dexRate: sumRate(dex),
    healthyChipRate: normalRate > 0 ? Math.max(0, normalRate - badRate) / normalRate : 0
  };
}
