import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, StarIcon } from "./Icons.jsx";
import { familyLabels, localTime, money, phaseLabels } from "../lib/format.js";
import { gmgnTokenUrl } from "../lib/gmgn.js";

function List({ items, empty, tone }) {
  if (!items?.length) return <p className="list-empty">{empty}</p>;
  return (
    <ul className={`evidence-list ${tone}`}>
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function scoreStatus(status) {
  if (status === "verified") return "Top100 已验证";
  if (status === "failed") return "尽调失败";
  return "等待尽调";
}

function shortWallet(address) {
  if (!address) return "未知地址";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function holderPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const percentage = value * 100;
  return `${percentage < 0.1 ? percentage.toFixed(3) : percentage.toFixed(2)}%`;
}

export default function Inspector({ item, watched, watchBusy, calibration, page, onToggleWatch }) {
  const [copied, setCopied] = useState(false);
  if (!item) {
    return <aside className="inspector empty-inspector"><p>选择一个候选查看证据与风险。</p></aside>;
  }
  async function copyAddress() {
    await navigator.clipboard.writeText(item.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  const gmgnUrl = gmgnTokenUrl(item.chain, item.address);
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span>
          <h2>{item.symbol}</h2>
          <p>{item.name !== "?" ? item.name : "未提供名称"}</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className={`watch-button ${watched ? "is-active" : ""}`}
            onClick={() => onToggleWatch(item)}
            disabled={watchBusy}
            aria-label={watched ? "取消收藏" : "加入收藏"}
            title={watched ? "取消重点观察" : "收藏为重点观察"}
          >
            <StarIcon filled={watched} />
          </button>
          <div className="score-orbit" aria-label={`${item.score} 分`}>
            <strong>{item.score}</strong><span>/100</span>
          </div>
        </div>
      </div>

      {item.isLive === false && (
        <div className="stale-watch" role="status">本轮扫描未命中，正在保留收藏时的最后快照。</div>
      )}

      <div className={`strategy-banner strategy-banner-${page.key}`} role="note">
        <strong>{page.key === "discovery" ? "猎星榜 · early-v2" : page.name}</strong>
        <span>{page.key === "discovery" ? "硬过滤：持币地址必须 >300，市值必须在 $10k–$2M；风险尽调不参与入榜。" : "已将关键风险缺失、关联控盘与高 Bundler 纳入过滤。"}</span>
      </div>

      <div className="contract-block">
        <span>{item.chain.toUpperCase()} · {phaseLabels[item.phase] || item.phase}</span>
        <code title={item.address}>{item.address}</code>
        <button type="button" onClick={copyAddress} aria-label="复制合约地址">
          {copied ? <CheckIcon /> : <CopyIcon />}{copied ? "已复制" : "复制"}
        </button>
      </div>

      <a className="gmgn-detail-link" href={gmgnUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLinkIcon />在 GMGN 查看详情
      </a>

      <div className="metric-grid">
        <div><span>市值</span><strong>{money(item.marketCap)}</strong></div>
        <div><span>流动性</span><strong>{money(item.liquidity)}</strong></div>
        <div><span>安全分</span><strong>{item.safetyScore ?? "—"}</strong></div>
        <div><span>数据完整度</span><strong>{Number.isFinite(item.dataCompleteness) ? `${item.dataCompleteness}%` : "—"}</strong></div>
      </div>

      <section className="inspector-section evidence-summary">
        <div className="section-heading-row">
          <h3>验证与历史置信度</h3>
          <span className={`verification verification-${item.verificationStatus || "pending"}`}>{scoreStatus(item.verificationStatus)}</span>
        </div>
        <div className="confidence-grid">
          <div>
            <span>校准概率</span>
            <strong>{Number.isFinite(item.calibratedProbability) ? percent(item.calibratedProbability) : "暂不提供"}</strong>
            <small>{item.calibrationSamples || 0} 个同链同分段成熟样本</small>
          </div>
          <div>
            <span>当前历史表现</span>
            <strong>{Number.isFinite(item.history?.currentReturnPct) ? `${item.history.currentReturnPct.toFixed(1)}%` : "采集中"}</strong>
            <small>{item.history?.observations || 0} 次价格观测</small>
          </div>
        </div>
        <p className="calibration-note">{calibration?.definition || "达到足够的 6 小时成熟样本后才显示经验概率。"}</p>
      </section>

      <section className="inspector-section">
        <h3>Top100 筹码结构</h3>
        {item.holderAnalysis?.status === "verified" ? (
          <div className="chip-grid">
            <div><span>Top10</span><strong>{percent(item.holderAnalysis.top10Rate)}</strong></div>
            <div><span>最大普通钱包</span><strong>{percent(item.holderAnalysis.largestWalletRate)}</strong></div>
            <div><span>Bundler</span><strong>{percent(item.holderAnalysis.bundlerRate)}</strong></div>
            <div><span>同源关联</span><strong>{percent(item.holderAnalysis.relatedRate)}</strong></div>
            <div><span>同步注资</span><strong>{percent(item.holderAnalysis.coordinatedRate)}</strong></div>
            <div><span>风险钱包</span><strong>{percent(item.holderAnalysis.riskWalletRate)}</strong></div>
            <div><span>当前聪明钱</span><strong>{item.holderAnalysis.currentSmartHolderCount ?? "—"}</strong></div>
            <div><span>当前 KOL</span><strong>{item.holderAnalysis.currentKolHolderCount ?? "—"}</strong></div>
          </div>
        ) : (
          <p className="list-empty">{item.deepAnalysisError || "当前候选尚未完成 Top100 持仓关联尽调；未验证时不会进入 ALERT。"}</p>
        )}
      </section>

      <section className="inspector-section">
        <div className="section-heading-row">
          <h3>当前持有的 KOL</h3>
          <span className="holder-count">{item.holderAnalysis?.currentKolHolderCount ?? "—"} 个</span>
        </div>
        {Array.isArray(item.holderAnalysis?.currentKolHolders) ? (
          item.holderAnalysis.currentKolHolders.length ? (
            <div className="holder-list">
              {item.holderAnalysis.currentKolHolders.map((holder) => (
                <div className="holder-row" key={holder.address}>
                  <div>
                    <strong>{holder.name || shortWallet(holder.address)}</strong>
                    <span>{holder.twitterUsername ? `@${holder.twitterUsername}` : shortWallet(holder.address)}</span>
                  </div>
                  <div>
                    <strong>{holderPercent(holder.amountPercentage)}</strong>
                    <span>买 {holder.buyTxCount} / 卖 {holder.sellTxCount}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="list-empty">未发现当前余额大于 0 的 GMGN KOL 钱包。</p>
        ) : <p className="list-empty">等待下一轮深度扫描生成 KOL 持仓名单。</p>}
        <p className="holder-note">
          只统计当前余额大于 0 的 GMGN KOL 标签钱包；已清仓者不会计入。
          {item.holderAnalysis?.currentKolCoverage === "top100-only" ? " 当前名单仅覆盖 Top100，可能不完整。" : ""}
        </p>
      </section>

      <section className="inspector-section">
        <h3>为什么进入雷达</h3>
        <List items={item.reasons} empty="暂无强证据。" tone="positive" />
      </section>

      <section className="inspector-section">
        <h3>风险与硬过滤</h3>
        <List items={[...(item.hardStops || []), ...(item.alertBlocks || []), ...(item.risks || [])]} empty="当前数据未发现已知硬风险，仍需人工尽调。" tone="risk" />
      </section>

      <section className="inspector-section">
        <h3>信号来源</h3>
        <div className="source-list">
          {(item.evidenceFamilies || []).map((family) => <span key={family}>{familyLabels[family] || family}</span>)}
        </div>
      </section>

      <div className="timeline-grid">
        <div><span>首次发现</span><strong>{localTime(item.firstSeen)}</strong></div>
        <div><span>最近出现</span><strong>{localTime(item.lastSeen)}</strong></div>
      </div>
      <p className="disclaimer">研究优先级，不是买入建议。任何交易前都应再次检查合约、池子和退出流动性。</p>
    </aside>
  );
}
