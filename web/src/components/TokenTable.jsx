import { useEffect, useState } from "react";
import { compact, creationAge, localTime, money, phaseLabels, shortAddress } from "../lib/format.js";
import { gmgnAppIntentUrl, gmgnTokenUrl } from "../lib/gmgn.js";
import { twitterContractSearchUrl } from "../lib/social.js";
import { ExternalLinkIcon, RemoveIcon, SearchIcon, StarIcon } from "./Icons.jsx";

function Priority({ value }) {
  return <span className={`priority priority-${value.toLowerCase()}`}>{value}</span>;
}

function QuickWatchButton({ item, watched, busy, mobile = false, onToggle }) {
  return (
    <button
      className={`quick-watch-button ${watched ? "is-watched" : ""} ${mobile ? "mobile-quick-watch" : ""}`}
      type="button"
      disabled={busy}
      aria-pressed={watched}
      aria-label={watched ? `取消收藏 ${item.symbol}` : `快速收藏 ${item.symbol}`}
      title={watched ? "已收藏，点击取消" : "快速收藏"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(item);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <StarIcon filled={watched} />
    </button>
  );
}

function Verification({ status }) {
  const label = status === "verified" ? "Top100" : status === "failed" ? "失败" : "待查";
  return <span className={`verification verification-${status || "pending"}`}>{label}</span>;
}

function currentHolderCount(item, field) {
  const value = item.holderAnalysis?.[field];
  return Number.isFinite(value) ? compact(value) : "—";
}

function currentHolderValue(item, field) {
  const value = item.holderAnalysis?.[field];
  return Number.isFinite(value) ? value : null;
}

function safetyScore(item) {
  return Number.isFinite(item.safetyScore) ? item.safetyScore : null;
}

function hasRenownedDeveloper(item) {
  return (item.holderAnalysis?.devRenownedWalletCount || 0) > 0
    || item.holderAnalysis?.developerWallets?.some((wallet) => wallet.isRenowned);
}

function narrativeFor(item) {
  return item.narrative || {
    category: "叙事待扫描",
    categoryKey: "unknown",
    summary: "等待下一轮扫描获取项目简介与叙事线索。",
    sourceLabel: "待扫描"
  };
}

function CreationAge({ timestamp }) {
  const available = Number.isFinite(timestamp) && timestamp > 0;
  return (
    <span
      className={`age-badge ${available ? "" : "age-unknown"}`}
      title={available ? `创建于 ${localTime(timestamp, true)}` : "GMGN 未返回代币创建时间"}
    >
      {creationAge(timestamp)}
    </span>
  );
}

function marketCapBand(value) {
  if (!Number.isFinite(value)) return { key: "unknown", label: "市值未知" };
  if (value < 50_000) return { key: "micro", label: "市值低于 $50K" };
  if (value < 200_000) return { key: "small", label: "市值 $50K–$200K" };
  if (value < 1_000_000) return { key: "medium", label: "市值 $200K–$1M" };
  return { key: "large", label: "市值高于 $1M" };
}

function MarketCap({ value }) {
  const band = marketCapBand(value);
  return <strong className={`market-cap market-cap-${band.key}`} title={band.label}>{money(value)}</strong>;
}

function sparklinePath(points, width = 118, height = 34) {
  const values = (Array.isArray(points) ? points : [])
    .map((point) => [Number(point?.[0]), Number(point?.[1])])
    .filter(([time, price]) => Number.isFinite(time) && Number.isFinite(price) && price > 0);
  if (values.length < 2) return "";
  const times = values.map(([time]) => time);
  const prices = values.map(([, price]) => price);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const timeRange = maxTime - minTime;
  const priceRange = maxPrice - minPrice;
  const padding = 2;
  return values.map(([time, price], index) => {
    const xRatio = timeRange ? (time - minTime) / timeRange : index / (values.length - 1);
    const yRatio = priceRange ? (price - minPrice) / priceRange : 0.5;
    const x = padding + xRatio * (width - padding * 2);
    const y = height - padding - yRatio * (height - padding * 2);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function trendPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(Math.abs(value));
  return `${value >= 0 ? "+" : "−"}${formatted}%`;
}

function LifetimeTrend({ item }) {
  const trend = item.lifetimeTrend;
  const path = trend?.status === "ready" ? sparklinePath(trend.points) : "";
  if (!path) {
    return (
      <div className="lifetime-trend trend-empty" title="GMGN 暂未返回足够的创建以来 K 线">
        <span>创建→本轮</span>
        <strong>暂无K线</strong>
      </div>
    );
  }
  const tone = trend.changePct >= 0 ? "up" : "down";
  return (
    <div
      className={`lifetime-trend trend-${tone}`}
      title={`创建于 ${localTime(trend.from, true)}；K线更新至 ${localTime(trend.updatedAt, true)}${trend.stale ? "（缓存）" : ""}`}
    >
      <div className="trend-caption">
        <span>创建→本轮</span>
        <strong>{trendPercent(trend.changePct)}</strong>
      </div>
      <svg viewBox="0 0 118 34" preserveAspectRatio="none" role="img" aria-label={`创建以来涨跌 ${trendPercent(trend.changePct)}`}>
        <path d={path} />
      </svg>
    </div>
  );
}

function scoreTone(score) {
  if (score >= 70) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function hitTone(count) {
  if (count >= 6) return "strong";
  if (count >= 3) return "steady";
  if (count >= 1) return "new";
  return "empty";
}

function SignalCount({ item, field, kind }) {
  const value = currentHolderValue(item, field);
  return (
    <span className={`signal-tag signal-tag-${kind} ${value > 0 ? "has-signal" : "is-empty"}`}>
      {value === null ? "—" : compact(value)}
    </span>
  );
}

function DeveloperHistory({ item, mobile = false }) {
  const history = item.developerHistory;
  if (history?.status !== "ready") {
    return <div className={`developer-history-summary ${mobile ? "mobile-developer-history" : ""} is-pending`}>开发履历待查</div>;
  }
  const count = Number.isFinite(history.totalCreatedCount) ? history.totalCreatedCount : "—";
  const topToken = Array.isArray(history.topTokens) ? history.topTokens[0] : null;
  const title = topToken
    ? `开发者 ATH Top1：${topToken.symbol}；历史最高市值 ${money(topToken.athMarketCap)}`
    : "未返回其他历史代币";
  return (
    <div className={`developer-history-summary ${mobile ? "mobile-developer-history" : ""}`} title={title}>
      <span className="developer-token-count">累计 {history.countIsMinimum ? "≥" : ""}{count} 币</span>
      <span className="developer-ath-list">
        <i>开发 ATH Top1</i>
        {topToken
          ? <><b>{topToken.symbol}</b><em>历史最高市值 {money(topToken.athMarketCap)}</em></>
          : <b>暂无历史币</b>}
      </span>
    </div>
  );
}

function SameNameLeader({ item, mobile = false }) {
  const reference = item.sameNameLeader;
  const leader = reference?.leader;
  if (reference?.status !== "ready" || !leader) {
    return (
      <div className={`same-name-list-summary ${mobile ? "mobile-same-name-summary" : ""} is-pending`}>
        <i>同名最高</i><span>{reference?.status === "empty" ? "未找到同代码代币" : "当前最高市值待查"}</span>
      </div>
    );
  }
  const leaderName = leader.name && leader.name !== "?" ? leader.name : leader.symbol;
  return (
    <div
      className={`same-name-list-summary ${mobile ? "mobile-same-name-summary" : ""}`}
      title={`同名当前最高市值代币：${leaderName}（${leader.symbol}），当前最高市值 ${money(leader.marketCap)}`}
    >
      <i>同名最高</i>
      <b>{leaderName}</b>
      <em>当前最高市值 {money(leader.marketCap)}</em>
      {reference.isCurrent && <small>当前币</small>}
    </div>
  );
}

function openOnKeyboard(event, item, onSelect) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(item);
  }
}

function useMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = (event) => setIsMobile(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export default function TokenTable({ items, selectedKey, watchedKeys, showWatchHits, watchBusyKey, onSelect, onToggleWatch }) {
  const isMobile = useMobileLayout();
  return (
    <div className="table-region">
      {!isMobile && <table className={showWatchHits ? "watch-hit-table" : ""}>
        <thead>
          <tr>
            <th>优先级</th>
            <th>代币</th>
            <th>创建走势</th>
            <th className="number">分数</th>
            <th className="number">安全分</th>
            {showWatchHits && <th className="number" title="收藏后进入 ALERT 或 WATCH 的累计轮数">累计命中</th>}
            <th className="number">市值</th>
            <th className="number">流动性</th>
            <th className="number">持币地址</th>
            <th className="number" title="当前余额大于 0 的 GMGN 聪明钱钱包">当前聪明钱</th>
            <th className="number" title="当前余额大于 0 的 GMGN KOL 钱包">当前KOL</th>
            <th className="number">信号</th>
            <th>验证</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.key}
              className={selectedKey === item.key ? "selected" : ""}
              onClick={() => onSelect(item)}
              onKeyDown={(event) => openOnKeyboard(event, item, onSelect)}
              tabIndex="0"
            >
              <td><Priority value={item.priority} /></td>
              <td>
                <div className="token-cell">
                  <div className="token-title-line">
                    <a
                      className="gmgn-token-link"
                      href={gmgnTokenUrl(item.chain, item.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`在 GMGN 查看 ${item.symbol}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(item);
                      }}
                    >
                      <span className="token-symbol">
                        <strong>{item.symbol}</strong>
                        {hasRenownedDeveloper(item) && (
                          <span className="renowned-dev-badge" title="GMGN 将该开发者钱包标记为 renowned 或 KOL；不等同于官方身份认证">知名开发者</span>
                        )}
                        <ExternalLinkIcon />
                      </span>
                    </a>
                    <a
                      className="twitter-contract-search"
                      href={twitterContractSearchUrl(item.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`在 X 搜索 ${item.symbol} 的合约地址`}
                      title="用合约地址搜索 X / Twitter"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <SearchIcon />
                    </a>
                    {!showWatchHits && (
                      <QuickWatchButton
                        item={item}
                        watched={watchedKeys.has(item.key)}
                        busy={watchBusyKey === item.key}
                        onToggle={onToggleWatch}
                      />
                    )}
                    {showWatchHits && (
                      <button
                        className="watch-remove-inline"
                        type="button"
                        disabled={watchBusyKey === item.key}
                        aria-label={`从收藏移除 ${item.symbol}`}
                        title="从收藏列表移除"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleWatch(item);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <RemoveIcon />
                        <span>{watchBusyKey === item.key ? "移除中" : "移除"}</span>
                      </button>
                    )}
                  </div>
                  <span className="token-name" title={item.address}>{item.name !== "?" ? item.name : shortAddress(item.address)}</span>
                  <span className="token-meta">
                    <span className={`chain chain-${item.chain}`}>{item.chain.toUpperCase()}</span>
                    <span className={`phase phase-${item.phase.toLowerCase()}`}>{phaseLabels[item.phase] || item.phase}</span>
                    <CreationAge timestamp={item.creationTimestamp} />
                    <span
                      className={`narrative-badge narrative-${narrativeFor(item).categoryKey}`}
                      title={`${narrativeFor(item).sourceLabel}：${narrativeFor(item).summary}`}
                    >
                      {narrativeFor(item).category}
                    </span>
                  </span>
                  <DeveloperHistory item={item} />
                  <SameNameLeader item={item} />
                </div>
              </td>
              <td className="trend-cell"><LifetimeTrend item={item} /></td>
              <td className="number score-cell">
                <strong className={`score-badge score-${scoreTone(item.score)}`}>{item.score}</strong>
                <span style={{ "--score": item.score }} />
              </td>
              <td className="number safety-cell">
                <span className={`metric-tag safety-tag safety-${item.safetyStatus || "pending"}`}>
                  {safetyScore(item) ?? "—"}{Number.isFinite(safetyScore(item)) ? "/100" : ""}
                </span>
              </td>
              {showWatchHits && (
                <td className="number hit-count-cell">
                  <span className={`metric-tag hit-tag hit-${hitTone(item.watchHitCount || 0)}`}>{item.watchHitCount || 0} 轮</span>
                </td>
              )}
              <td className="number"><MarketCap value={item.marketCap} /></td>
              <td className="number">{money(item.liquidity)}</td>
              <td className="number">{compact(item.holderCount)}</td>
              <td className="number"><SignalCount item={item} field="currentSmartHolderCount" kind="smart" /></td>
              <td className="number"><SignalCount item={item} field="currentKolHolderCount" kind="kol" /></td>
              <td className="number">
                <span className={`signal-tag signal-tag-evidence ${(item.evidenceFamilyCount || 0) >= 2 ? "has-signal" : "is-empty"}`}>
                  {item.evidenceFamilyCount || 0}
                </span>
              </td>
              <td><Verification status={item.verificationStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>}
      {isMobile && <div className="mobile-token-list">
        {items.map((item) => (
          <article
            className={`mobile-token-card ${selectedKey === item.key ? "selected" : ""}`}
            key={item.key}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => openOnKeyboard(event, item, onSelect)}
            role="button"
            tabIndex="0"
          >
            <div className="mobile-token-head">
              <Priority value={item.priority} />
              <div className="mobile-token-title">
                <div className="mobile-symbol-row">
                  <strong>{item.symbol}</strong>
                  <a
                    className="twitter-contract-search"
                    href={twitterContractSearchUrl(item.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`在 X 搜索 ${item.symbol} 的合约地址`}
                    title="用合约地址搜索 X / Twitter"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <SearchIcon />
                  </a>
                </div>
                <span>{item.name !== "?" ? item.name : shortAddress(item.address)}</span>
              </div>
              {showWatchHits ? (
                <button
                  className="watch-remove-inline mobile-watch-remove"
                  type="button"
                  disabled={watchBusyKey === item.key}
                  aria-label={`从收藏移除 ${item.symbol}`}
                  title="从收藏列表移除"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleWatch(item);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <RemoveIcon />
                  <span>{watchBusyKey === item.key ? "移除中" : "移除"}</span>
                </button>
              ) : (
                <QuickWatchButton
                  item={item}
                  watched={watchedKeys.has(item.key)}
                  busy={watchBusyKey === item.key}
                  mobile
                  onToggle={onToggleWatch}
                />
              )}
              <div className={`mobile-score score-${scoreTone(item.score)}`}><strong>{item.score}</strong><span>分</span></div>
            </div>
            <div className="mobile-token-tags">
              <span className={`chain chain-${item.chain}`}>{item.chain.toUpperCase()}</span>
              <span className={`phase phase-${item.phase.toLowerCase()}`}>{phaseLabels[item.phase] || item.phase}</span>
              <CreationAge timestamp={item.creationTimestamp} />
              <Verification status={item.verificationStatus} />
              {hasRenownedDeveloper(item) && (
                <span className="renowned-dev-badge" title="GMGN renowned / KOL 开发者钱包标签">知名开发者</span>
              )}
              <span
                className={`narrative-badge narrative-${narrativeFor(item).categoryKey}`}
                title={`${narrativeFor(item).sourceLabel}：${narrativeFor(item).summary}`}
              >
                {narrativeFor(item).category}
              </span>
              <span className="mobile-gmgn-actions">
                <a
                  href={gmgnAppIntentUrl(item.chain, item.address)}
                  className="mobile-gmgn-link mobile-gmgn-app-link"
                  onClick={(event) => event.stopPropagation()}
                >
                  GMGN App <ExternalLinkIcon />
                </a>
                <a
                  href={gmgnTokenUrl(item.chain, item.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mobile-gmgn-link mobile-gmgn-web-link"
                  onClick={(event) => event.stopPropagation()}
                >
                  网页 <ExternalLinkIcon />
                </a>
              </span>
            </div>
            <p className="mobile-narrative"><strong>叙事</strong>{narrativeFor(item).summary}</p>
            <DeveloperHistory item={item} mobile />
            <SameNameLeader item={item} mobile />
            <LifetimeTrend item={item} />
            <div className="mobile-token-metrics">
              <div><span>市值</span><MarketCap value={item.marketCap} /></div>
              <div className={`safety-${item.safetyStatus || "pending"}`}>
                <span>安全分</span>
                <strong className="mobile-metric-tag">{safetyScore(item) ?? "—"}{Number.isFinite(safetyScore(item)) ? "/100" : ""}</strong>
              </div>
              {showWatchHits
                ? <div className={`hit-metric hit-${hitTone(item.watchHitCount || 0)}`}><span>累计命中</span><strong>{item.watchHitCount || 0} 轮</strong></div>
                : <div><span>持币地址</span><strong>{compact(item.holderCount)}</strong></div>}
              <div>
                <span>关键钱包</span>
                <strong className="mobile-signal-pair">
                  <span className="smart-signal">聪 {currentHolderCount(item, "currentSmartHolderCount")}</span>
                  <span className="kol-signal">KOL {currentHolderCount(item, "currentKolHolderCount")}</span>
                </strong>
              </div>
            </div>
          </article>
        ))}
      </div>}
      {!items.length && (
        <div className="empty-state">
          <strong>没有匹配的候选</strong>
          <span>调整筛选条件，或等待下一轮扫描。</span>
        </div>
      )}
    </div>
  );
}
