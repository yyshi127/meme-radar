import { compact, money, phaseLabels, shortAddress } from "../lib/format.js";
import { gmgnTokenUrl } from "../lib/gmgn.js";
import { ExternalLinkIcon, StarIcon } from "./Icons.jsx";

function Priority({ value }) {
  return <span className={`priority priority-${value.toLowerCase()}`}>{value}</span>;
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

function openOnKeyboard(event, item, onSelect) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(item);
  }
}

export default function TokenTable({ items, selectedKey, watchedKeys, showWatchHits, onSelect }) {
  return (
    <div className="table-region">
      <table className={showWatchHits ? "watch-hit-table" : ""}>
        <thead>
          <tr>
            <th>优先级</th>
            <th>代币</th>
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
                      {watchedKeys.has(item.key) && <span className="watched-mark" title="已收藏"><StarIcon filled /></span>}
                      <ExternalLinkIcon />
                    </span>
                    <span title={item.address}>{item.name !== "?" ? item.name : shortAddress(item.address)}</span>
                  </a>
                  <span className="token-meta">
                    <span className={`chain chain-${item.chain}`}>{item.chain.toUpperCase()}</span>
                    <span className={`phase phase-${item.phase.toLowerCase()}`}>{phaseLabels[item.phase] || item.phase}</span>
                    <span
                      className={`narrative-badge narrative-${narrativeFor(item).categoryKey}`}
                      title={`${narrativeFor(item).sourceLabel}：${narrativeFor(item).summary}`}
                    >
                      {narrativeFor(item).category}
                    </span>
                  </span>
                </div>
              </td>
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
              <td className="number">{money(item.marketCap)}</td>
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
      </table>
      <div className="mobile-token-list">
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
                <strong>{item.symbol}</strong>
                <span>{item.name !== "?" ? item.name : shortAddress(item.address)}</span>
              </div>
              {watchedKeys.has(item.key) && <span className="mobile-watch-mark" title="已收藏"><StarIcon filled /></span>}
              <div className={`mobile-score score-${scoreTone(item.score)}`}><strong>{item.score}</strong><span>分</span></div>
            </div>
            <div className="mobile-token-tags">
              <span className={`chain chain-${item.chain}`}>{item.chain.toUpperCase()}</span>
              <span className={`phase phase-${item.phase.toLowerCase()}`}>{phaseLabels[item.phase] || item.phase}</span>
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
              <a
                href={gmgnTokenUrl(item.chain, item.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="mobile-gmgn-link"
                onClick={(event) => event.stopPropagation()}
              >
                GMGN <ExternalLinkIcon />
              </a>
            </div>
            <p className="mobile-narrative"><strong>叙事</strong>{narrativeFor(item).summary}</p>
            <div className="mobile-token-metrics">
              <div><span>市值</span><strong>{money(item.marketCap)}</strong></div>
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
      </div>
      {!items.length && (
        <div className="empty-state">
          <strong>没有匹配的候选</strong>
          <span>调整筛选条件，或等待下一轮扫描。</span>
        </div>
      )}
    </div>
  );
}
