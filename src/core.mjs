const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddress(chain, address) {
  if (typeof address !== "string") return false;
  return chain === "sol" ? SOL_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

export function cleanText(value, fallback = "?", maxLength = 80) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
}

function number(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
  if (value === true || value === 1 || value === "1" || value === "yes") return true;
  if (value === false || value === 0 || value === "0" || value === "no") return false;
  return null;
}

function seconds(value) {
  const parsed = number(value);
  if (parsed === null) return null;
  return parsed > 1e12 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function first(row, names) {
  for (const name of names) {
    if (row?.[name] !== null && row?.[name] !== undefined && row[name] !== "") {
      return row[name];
    }
  }
  return null;
}

export function getCandidate(book, chain, address) {
  if (!isValidAddress(chain, address)) return null;
  const key = `${chain}:${address.toLowerCase()}`;
  if (!book.has(key)) {
    book.set(key, {
      key,
      chain,
      address,
      symbol: "?",
      name: "?",
      sources: new Set(),
      stages: new Set(),
      signalTypes: new Set(),
      smartMakers: new Set(),
      kolMakers: new Set(),
      smartBuyUsd: 0,
      kolBuyUsd: 0,
      smartTradeCount: 0,
      kolTradeCount: 0
    });
  }
  return book.get(key);
}

function put(candidate, name, value) {
  if (value !== null && value !== undefined && value !== "") candidate[name] = value;
}

function putMax(candidate, name, value) {
  if (!Number.isFinite(value)) return;
  candidate[name] = Number.isFinite(candidate[name]) ? Math.max(candidate[name], value) : value;
}

export function mergeMarketRow(candidate, row, source, stage = null) {
  if (!candidate || !row) return;
  candidate.sources.add(source);
  if (stage) candidate.stages.add(stage);
  const priceStats = row.price && typeof row.price === "object" ? row.price : null;
  const links = row.link && typeof row.link === "object" ? row.link : null;
  const stats = row.stat && typeof row.stat === "object" ? row.stat : null;
  const walletStats = row.wallet_tags_stat && typeof row.wallet_tags_stat === "object" ? row.wallet_tags_stat : null;

  put(candidate, "symbol", cleanText(first(row, ["symbol", "trans_symbol"]), candidate.symbol));
  put(candidate, "name", cleanText(first(row, ["name", "trans_name"]), candidate.name));
  const currentPrice = number(priceStats?.price ?? first(row, ["price", "price_usd"]));
  put(candidate, "price", currentPrice);
  const suppliedMarketCap = number(first(row, ["market_cap", "usd_market_cap"]));
  const circulatingSupply = number(row.circulating_supply);
  put(candidate, "marketCap", suppliedMarketCap ?? (currentPrice !== null && circulatingSupply !== null ? currentPrice * circulatingSupply : null));
  put(candidate, "liquidity", number(row.liquidity));
  putMax(candidate, "volume1m", number(priceStats?.volume_1m ?? first(row, ["volume_1m", source === "trending" ? "volume" : null].filter(Boolean))));
  putMax(candidate, "volume24h", number(row.volume_24h));
  putMax(candidate, "swaps1m", number(priceStats?.swaps_1m ?? first(row, ["swaps_1m", source === "trending" ? "swaps" : null].filter(Boolean))));
  putMax(candidate, "buys1m", number(priceStats?.buys_1m ?? first(row, ["buys_1m", source === "trending" ? "buys" : null].filter(Boolean))));
  putMax(candidate, "sells1m", number(priceStats?.sells_1m ?? first(row, ["sells_1m", source === "trending" ? "sells" : null].filter(Boolean))));
  putMax(candidate, "holderCount", number(row.holder_count ?? stats?.holder_count));
  putMax(candidate, "smartHolderCount", number(row.smart_degen_count ?? walletStats?.smart_wallets));
  putMax(candidate, "kolHolderCount", number(row.renowned_count ?? walletStats?.renowned_wallets));
  put(candidate, "top10Rate", number(row.top_10_holder_rate ?? stats?.top_10_holder_rate));
  put(candidate, "rugRatio", number(row.rug_ratio));
  put(candidate, "bundlerRate", number(first(row, ["bundler_rate", "bundler_trader_amount_rate"])));
  put(candidate, "insiderRate", number(first(row, ["rat_trader_amount_rate", "suspected_insider_hold_rate"])));
  put(candidate, "priceChange1m", number(row.price_change_percent1m));
  put(candidate, "priceChange5m", number(row.price_change_percent5m));
  put(candidate, "priceChange1h", number(row.price_change_percent1h));
  put(candidate, "creationTimestamp", seconds(first(row, ["creation_timestamp", "created_timestamp"])));
  put(candidate, "platform", cleanText(first(row, ["launchpad_platform", "launchpad"]), candidate.platform));
  put(candidate, "twitter", cleanText(first(row, ["twitter_username", "twitter_handle", "twitter"]) ?? links?.twitter_username, candidate.twitter));
  put(candidate, "website", cleanText(row.website ?? links?.website, candidate.website));
  put(candidate, "telegram", cleanText(row.telegram ?? links?.telegram, candidate.telegram));
  candidate.hasSocial = Boolean(candidate.hasSocial || bool(first(row, ["has_at_least_one_social"])) || row.twitter_username || row.twitter || row.website || row.telegram || links?.twitter_username || links?.website || links?.telegram);
  put(candidate, "isHoneypot", bool(row.is_honeypot));
  put(candidate, "isWashTrading", bool(row.is_wash_trading));
  put(candidate, "renouncedMint", bool(row.renounced_mint));
  put(candidate, "renouncedFreeze", bool(row.renounced_freeze_account));
  put(candidate, "openSource", bool(first(row, ["is_open_source", "open_source"])));
  put(candidate, "ownerRenounced", bool(first(row, ["is_renounced", "owner_renounced"])));
}

export function mergeSignal(candidate, event) {
  if (!candidate || !event) return;
  const type = number(event.signal_type);
  if (type !== null) candidate.signalTypes.add(type);
  const source = type === 12 ? "signal-smart" : type === 20 ? "signal-kol" : "signal";
  mergeMarketRow(candidate, event.data || {}, source);
  put(candidate, "marketCap", number(event.market_cap));
  put(candidate, "top10Rate", number(event.cur_data?.top_10_holder_rate));
  put(candidate, "holderCount", number(event.cur_data?.holder_count));
  put(candidate, "liquidity", number(event.cur_data?.liquidity));
  put(candidate, "lastSignalAt", seconds(event.trigger_at));
}

export function mergeTrade(candidate, trade, kind) {
  if (!candidate || !trade) return;
  const isSmart = kind === "smart";
  candidate.sources.add(isSmart ? "smart-trade" : "kol-trade");
  put(candidate, "symbol", cleanText(trade.base_token?.symbol, candidate.symbol));
  const maker = typeof trade.maker === "string" ? trade.maker : null;
  if (maker) (isSmart ? candidate.smartMakers : candidate.kolMakers).add(maker);
  const amount = number(trade.amount_usd) || 0;
  if (isSmart) {
    candidate.smartTradeCount += 1;
    candidate.smartBuyUsd += amount;
  } else {
    candidate.kolTradeCount += 1;
    candidate.kolBuyUsd += amount;
  }
  put(candidate, "lastTradeAt", Math.max(candidate.lastTradeAt || 0, seconds(trade.timestamp) || 0));
}

function sourceFamilies(candidate) {
  const families = new Set();
  for (const source of candidate.sources) {
    if (["trending", "new-creation", "near-completion"].includes(source)) families.add("market");
    if (source === "hot-search") families.add("attention");
    if (["smart-trade", "signal-smart"].includes(source)) families.add("smart-money");
    if (["kol-trade", "signal-kol"].includes(source)) families.add("kol-social");
    if (source === "signal") families.add("gmgn-signal");
  }
  if ((candidate.smartHolderCount || 0) > 0) families.add("smart-money");
  if ((candidate.kolHolderCount || 0) > 0) families.add("kol-social");
  return families;
}

function requiredRiskFields(candidate) {
  const common = ["liquidity", "rugRatio", "top10Rate", "bundlerRate", "insiderRate"];
  return candidate.chain === "sol"
    ? [...common, "renouncedMint", "renouncedFreeze"]
    : [...common, "openSource", "ownerRenounced", "isHoneypot"];
}

function verification(candidate) {
  const required = requiredRiskFields(candidate);
  const missing = required.filter((field) => candidate[field] === undefined || candidate[field] === null);
  const completeness = Math.round(((required.length - missing.length) / required.length) * 100);
  const deepStatus = candidate.holderAnalysis?.status || candidate.verificationStatus || "pending";
  return { required, missing, completeness, deepStatus };
}

function calculateSafetyScore(candidate, hardStops) {
  if (hardStops.length) return 0;
  let score = 100;
  score -= Math.min(35, (candidate.rugRatio || 0) * 100);
  score -= Math.min(25, (candidate.top10Rate || 0) * 35);
  score -= Math.min(30, (candidate.bundlerRate || 0) * 100);
  score -= Math.min(30, (candidate.insiderRate || 0) * 100);
  score -= Math.min(30, (candidate.holderAnalysis?.relatedRate || 0) * 100);
  score -= Math.min(15, (candidate.holderAnalysis?.coordinatedRate || 0) * 50);
  return Math.max(0, Math.round(score));
}

// 冻结的改造前最后一版评分。不要把验金榜的新规则合并进这里。
export function scoreCandidateLegacy(candidate, options = {}) {
  const now = options.now || Math.floor(Date.now() / 1000);
  const alertScore = options.alertScore ?? 70;
  const watchScore = options.watchScore ?? 50;
  const reasons = [];
  const risks = [];
  const hardStops = [];
  let score = 0;

  const smartWallets = candidate.smartMakers.size;
  const kolWallets = candidate.kolMakers.size;
  if (smartWallets >= 3) { score += 34; reasons.push(`${smartWallets} 个聪明钱钱包在窗口内同向买入`); }
  else if (smartWallets === 2) { score += 24; reasons.push("2 个聪明钱钱包同向买入"); }
  else if (smartWallets === 1) { score += 10; reasons.push("1 个聪明钱钱包买入"); }

  if (kolWallets >= 3) { score += 8; reasons.push(`${kolWallets} 个 KOL 钱包买入`); }
  else if (kolWallets > 0) { score += 3 + kolWallets; reasons.push(`${kolWallets} 个 KOL 钱包买入`); }

  if (candidate.signalTypes.has(12)) { score += 8; reasons.push("GMGN 聪明钱信号触发"); }
  if (candidate.signalTypes.has(20)) { score += 4; reasons.push("GMGN KOL 信号触发"); }
  if (candidate.sources.has("trending")) { score += 8; reasons.push("进入 1 分钟趋势榜"); }
  if (candidate.sources.has("hot-search")) { score += 6; reasons.push("进入 1 分钟热搜榜"); }
  if (candidate.stages.has("near-completion")) { score += 8; reasons.push("接近发射台毕业"); }
  else if (candidate.stages.has("new-creation")) { score += 4; reasons.push("新创建代币"); }

  const smartHolders = candidate.smartHolderCount || 0;
  if (smartHolders > 0) { score += Math.min(12, smartHolders * 3); reasons.push(`${smartHolders} 个 GMGN 聪明钱账户信号`); }
  const kolHolders = candidate.kolHolderCount || 0;
  if (kolHolders > 0) score += Math.min(6, kolHolders * 2);

  const families = sourceFamilies(candidate);
  if (families.size >= 3) { score += 14; reasons.push(`${families.size} 类信号共振`); }
  else if (families.size === 2) { score += 8; reasons.push("2 类信号共振"); }

  if ((candidate.liquidity || 0) >= 50_000) score += 8;
  else if ((candidate.liquidity || 0) >= 10_000) score += 4;

  if (candidate.marketCap >= 25_000 && candidate.marketCap <= 2_000_000) score += 6;
  else if (candidate.marketCap > 10_000_000) { score -= 8; risks.push("市值已超过 $10M，早期优势下降"); }

  const age = candidate.creationTimestamp ? now - candidate.creationTimestamp : null;
  if (age !== null && age >= 0 && age <= 6 * 3600) score += 5;
  else if (age !== null && age > 7 * 86400) score -= 5;
  if (candidate.hasSocial) score += 3;

  if ((candidate.buys1m || 0) >= 1.5 * Math.max(1, candidate.sells1m || 0)) score += 4;
  if ((candidate.priceChange5m || 0) > 50) { score -= 8; risks.push("5 分钟涨幅超过 50%，追高风险"); }
  if ((candidate.priceChange1h || 0) > 100) { score -= 12; risks.push("1 小时涨幅超过 100%，可能已进入后段"); }

  if (candidate.isHoneypot === true) hardStops.push("疑似貔貅盘");
  if (candidate.isWashTrading === true) hardStops.push("检测到刷量");
  if (candidate.liquidity !== undefined && candidate.liquidity < 10_000) hardStops.push("流动性低于 $10k");
  if (candidate.rugRatio > 0.3) hardStops.push(`Rug 风险 ${candidate.rugRatio.toFixed(2)} > 0.30`);
  else if (candidate.rugRatio >= 0.1) { score -= 10; risks.push(`Rug 风险 ${candidate.rugRatio.toFixed(2)}`); }
  if (candidate.top10Rate > 0.5) hardStops.push(`Top10 持仓 ${(candidate.top10Rate * 100).toFixed(1)}%`);
  else if (candidate.top10Rate >= 0.3) { score -= 10; risks.push(`Top10 持仓 ${(candidate.top10Rate * 100).toFixed(1)}%`); }
  if (candidate.bundlerRate > 0.3) hardStops.push(`Bundler 比例 ${(candidate.bundlerRate * 100).toFixed(1)}%`);
  else if (candidate.bundlerRate >= 0.15) { score -= 8; risks.push(`Bundler 比例 ${(candidate.bundlerRate * 100).toFixed(1)}%`); }
  if (candidate.insiderRate > 0.3) hardStops.push(`疑似内盘比例 ${(candidate.insiderRate * 100).toFixed(1)}%`);
  if (candidate.chain === "sol" && candidate.renouncedMint === false) hardStops.push("Mint 权限未放弃");
  if (candidate.chain === "sol" && candidate.renouncedFreeze === false) hardStops.push("Freeze 权限未放弃");
  if (candidate.chain !== "sol" && candidate.openSource === false) hardStops.push("合约未开源");
  if (candidate.chain !== "sol" && candidate.ownerRenounced === false) hardStops.push("Owner 权限未放弃");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tooLate = (candidate.priceChange1h || 0) > 150 || (candidate.marketCap || 0) > 20_000_000;
  const phase = tooLate ? "LATE" : smartWallets >= 2 || score >= watchScore ? "BREAKOUT" : age !== null && age <= 3600 ? "EARLY" : "WATCHING";
  const priority = hardStops.length
    ? "SKIP"
    : !tooLate && score >= alertScore && families.size >= 2
      ? "ALERT"
      : score >= watchScore
        ? "WATCH"
        : "LOW";

  return {
    ...candidate,
    sources: [...candidate.sources],
    stages: [...candidate.stages],
    signalTypes: [...candidate.signalTypes],
    smartMakers: [...candidate.smartMakers],
    kolMakers: [...candidate.kolMakers],
    evidenceFamilies: [...families],
    evidenceFamilyCount: families.size,
    score,
    phase,
    priority,
    reasons: reasons.slice(0, 6),
    risks,
    hardStops,
    strategy: "legacy-v1"
  };
}

export function scoreCandidateEarly(candidate, options = {}) {
  const legacy = scoreCandidateLegacy(candidate, options);
  const hardStops = [...legacy.hardStops];
  const holderCount = Number(candidate.holderCount);
  const marketCap = Number(candidate.marketCap);

  if (!Number.isFinite(holderCount)) hardStops.push("持币地址数据缺失");
  else if (holderCount <= 300) hardStops.push(`持币地址 ${Math.floor(holderCount)} ≤ 300`);

  if (!Number.isFinite(marketCap)) hardStops.push("市值数据缺失");
  else if (marketCap < 10_000 || marketCap > 2_000_000) {
    hardStops.push("市值不在 $10k–$2M 区间");
  }

  return {
    ...legacy,
    hardStops,
    priority: hardStops.length ? "SKIP" : legacy.priority,
    strategy: "early-v2"
  };
}

export function scoreCandidate(candidate, options = {}) {
  const now = options.now || Math.floor(Date.now() / 1000);
  const alertScore = options.alertScore ?? 70;
  const watchScore = options.watchScore ?? 50;
  const reasons = [];
  const risks = [];
  const hardStops = [];
  const alertBlocks = [];
  let score = 0;

  const smartWallets = candidate.smartMakers.size;
  const kolWallets = candidate.kolMakers.size;
  const smartHolders = candidate.smartHolderCount || 0;
  const kolHolders = candidate.kolHolderCount || 0;
  const smartActivityPoints = smartWallets >= 3 ? 34 : smartWallets === 2 ? 24 : smartWallets === 1 ? 10 : 0;
  const smartHolderPoints = Math.min(12, smartHolders * 3);
  const smartSignalPoints = candidate.signalTypes.has(12) ? 8 : 0;
  score += Math.max(smartActivityPoints, smartHolderPoints, smartSignalPoints);
  if (smartWallets > 0) reasons.push(`${smartWallets} 个聪明钱钱包在窗口内同向买入`);
  else if (smartHolders > 0) reasons.push(`${smartHolders} 个 GMGN 聪明钱账户信号`);
  else if (candidate.signalTypes.has(12)) reasons.push("GMGN 聪明钱信号触发");

  const kolActivityPoints = kolWallets >= 3 ? 8 : kolWallets > 0 ? 3 + kolWallets : 0;
  const kolHolderPoints = Math.min(6, kolHolders * 2);
  const kolSignalPoints = candidate.signalTypes.has(20) ? 4 : 0;
  score += Math.max(kolActivityPoints, kolHolderPoints, kolSignalPoints);
  if (kolWallets > 0) reasons.push(`${kolWallets} 个 KOL 钱包买入`);
  else if (kolHolders > 0) reasons.push(`${kolHolders} 个 GMGN KOL 账户信号`);
  else if (candidate.signalTypes.has(20)) reasons.push("GMGN KOL 信号触发");

  const marketPoints = Math.max(
    candidate.sources.has("trending") ? 8 : 0,
    candidate.stages.has("near-completion") ? 8 : candidate.stages.has("new-creation") ? 4 : 0
  );
  score += marketPoints;
  if (candidate.sources.has("trending")) reasons.push("进入 1 分钟趋势榜");
  else if (candidate.stages.has("near-completion")) reasons.push("接近发射台毕业");
  else if (candidate.stages.has("new-creation")) reasons.push("新创建代币");
  if (candidate.sources.has("hot-search")) { score += 6; reasons.push("进入 1 分钟热搜榜"); }

  const families = sourceFamilies(candidate);
  if (families.size >= 3) { score += 14; reasons.push(`${families.size} 类信号共振`); }
  else if (families.size === 2) { score += 8; reasons.push("2 类信号共振"); }

  if ((candidate.liquidity || 0) >= 50_000) score += 8;
  else if ((candidate.liquidity || 0) >= 10_000) score += 4;

  if (candidate.marketCap >= 25_000 && candidate.marketCap <= 2_000_000) score += 6;
  else if (candidate.marketCap > 10_000_000) { score -= 8; risks.push("市值已超过 $10M，早期优势下降"); }

  const age = candidate.creationTimestamp ? now - candidate.creationTimestamp : null;
  if (age !== null && age >= 0 && age <= 6 * 3600) score += 5;
  else if (age !== null && age > 7 * 86400) score -= 5;
  if (candidate.hasSocial) score += 3;
  if (Number.isFinite(candidate.walletReputationBonus) && candidate.walletReputationBonus !== 0) {
    score += candidate.walletReputationBonus;
    reasons.push(`历史钱包表现修正 ${candidate.walletReputationBonus > 0 ? "+" : ""}${candidate.walletReputationBonus}`);
  }

  if ((candidate.buys1m || 0) >= 1.5 * Math.max(1, candidate.sells1m || 0)) score += 4;
  if ((candidate.priceChange5m || 0) > 50) { score -= 8; risks.push("5 分钟涨幅超过 50%，追高风险"); }
  if ((candidate.priceChange1h || 0) > 100) { score -= 12; risks.push("1 小时涨幅超过 100%，可能已进入后段"); }

  if (candidate.isHoneypot === true) hardStops.push("疑似貔貅盘");
  if (candidate.isWashTrading === true) hardStops.push("检测到刷量");
  if (candidate.liquidity !== undefined && candidate.liquidity < 10_000) hardStops.push("流动性低于 $10k");
  if (candidate.rugRatio > 0.3) hardStops.push(`Rug 风险 ${candidate.rugRatio.toFixed(2)} > 0.30`);
  else if (candidate.rugRatio >= 0.1) { score -= 10; risks.push(`Rug 风险 ${candidate.rugRatio.toFixed(2)}`); }
  if (candidate.top10Rate > 0.5) hardStops.push(`Top10 持仓 ${(candidate.top10Rate * 100).toFixed(1)}%`);
  else if (candidate.top10Rate >= 0.3) { score -= 10; risks.push(`Top10 持仓 ${(candidate.top10Rate * 100).toFixed(1)}%`); }
  if (candidate.bundlerRate >= 0.2) hardStops.push(`Bundler 比例 ${(candidate.bundlerRate * 100).toFixed(1)}%`);
  else if (candidate.bundlerRate >= 0.1) {
    score -= 8;
    risks.push(`Bundler 比例 ${(candidate.bundlerRate * 100).toFixed(1)}%`);
    alertBlocks.push("Bundler 比例达到 10%，仅观察");
  }
  if (candidate.insiderRate > 0.3) hardStops.push(`疑似内盘比例 ${(candidate.insiderRate * 100).toFixed(1)}%`);
  if (candidate.chain === "sol" && candidate.renouncedMint === false) hardStops.push("Mint 权限未放弃");
  if (candidate.chain === "sol" && candidate.renouncedFreeze === false) hardStops.push("Freeze 权限未放弃");
  if (candidate.chain !== "sol" && candidate.openSource === false) hardStops.push("合约未开源");
  if (candidate.chain !== "sol" && candidate.ownerRenounced === false) hardStops.push("Owner 权限未放弃");

  const holder = candidate.holderAnalysis;
  if (holder?.status === "verified") {
    if (holder.relatedRate >= 0.2) hardStops.push(`关联钱包持仓 ${(holder.relatedRate * 100).toFixed(1)}%`);
    else if (holder.relatedRate >= 0.1) {
      risks.push(`关联钱包持仓 ${(holder.relatedRate * 100).toFixed(1)}%`);
      alertBlocks.push("关联钱包持仓达到 10%，仅观察");
    }
    if (holder.coordinatedRate >= 0.1) {
      risks.push(`疑似同步注资持仓 ${(holder.coordinatedRate * 100).toFixed(1)}%`);
      alertBlocks.push("疑似同步注资持仓达到 10%，仅观察");
    }
    if (holder.riskWalletRate > 0.3) hardStops.push(`风险钱包持仓 ${(holder.riskWalletRate * 100).toFixed(1)}%`);
    if (holder.insiderRate > 0.1) hardStops.push(`老鼠仓持仓 ${(holder.insiderRate * 100).toFixed(1)}%`);
    if (holder.largestWalletRate > 0.15) hardStops.push(`最大普通钱包持仓 ${(holder.largestWalletRate * 100).toFixed(1)}%`);
    if (holder.devSockPuppet) hardStops.push("Dev 疑似通过马甲钱包继续控盘");
    if (holder.airdropRate > 0.15) {
      risks.push(`零成本转入持仓 ${(holder.airdropRate * 100).toFixed(1)}%`);
      alertBlocks.push("零成本转入持仓超过 15%，仅观察");
    }
  }

  const verificationResult = verification(candidate);
  if (options.requireVerification) {
    if (verificationResult.deepStatus !== "verified") alertBlocks.push("Top100 持仓尽调尚未完成");
    if (verificationResult.missing.length) alertBlocks.push(`关键风险数据缺失：${verificationResult.missing.join(", ")}`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const safetyScore = calculateSafetyScore(candidate, hardStops);
  const tooLate = (candidate.priceChange1h || 0) > 150 || (candidate.marketCap || 0) > 20_000_000;
  const phase = tooLate ? "LATE" : smartWallets >= 2 || score >= watchScore ? "BREAKOUT" : age !== null && age <= 3600 ? "EARLY" : "WATCHING";
  const priority = hardStops.length
    ? "SKIP"
    : !tooLate && score >= alertScore && families.size >= 2 && alertBlocks.length === 0
      ? "ALERT"
      : score >= watchScore
        ? "WATCH"
        : "LOW";

  return {
    ...candidate,
    sources: [...candidate.sources],
    stages: [...candidate.stages],
    signalTypes: [...candidate.signalTypes],
    smartMakers: [...candidate.smartMakers],
    kolMakers: [...candidate.kolMakers],
    evidenceFamilies: [...families],
    evidenceFamilyCount: families.size,
    strategy: "safety",
    score,
    safetyScore,
    dataCompleteness: verificationResult.completeness,
    missingRiskFields: verificationResult.missing,
    verificationStatus: verificationResult.deepStatus,
    phase,
    priority,
    reasons: reasons.slice(0, 6),
    risks,
    hardStops,
    alertBlocks
  };
}

export function escapeMarkdown(value) {
  return cleanText(String(value ?? "?"))
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`");
}
