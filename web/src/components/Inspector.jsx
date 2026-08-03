import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, StarIcon } from "./Icons.jsx";
import { compact, familyLabels, localTime, money, phaseLabels } from "../lib/format.js";
import { gmgnAppIntentUrl, gmgnTokenUrl } from "../lib/gmgn.js";
import { twitterProfileUrl } from "../lib/social.js";

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

function safetyStatus(status) {
  if (status === "verified") return "已完成关键验证";
  if (status === "blocked") return "已发现硬风险";
  return "待完成关键验证";
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

function tokenPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  if (value < 0.000001) return `$${value.toExponential(3)}`;
  return `$${value.toLocaleString("en-US", { useGrouping: false, minimumSignificantDigits: 3, maximumSignificantDigits: 6 })}`;
}

function signedPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

const developerTagLabels = {
  bundler: "捆绑",
  rat_trader: "老鼠仓",
  sniper: "狙击",
  whale: "鲸鱼",
  fresh_wallet: "新钱包",
  wash_trader: "刷量",
  paper_hands: "纸手",
  renowned: "名人",
  kol: "KOL",
  smart_degen: "聪明钱",
  pump_smart: "聪明钱"
};

function developerTags(wallet) {
  return [...new Set([...(wallet.makerTokenTags || []), ...(wallet.tags || [])])]
    .filter((tag) => !["creator", "dev_team", "top_holder", "transfer_in"].includes(tag))
    .map((tag) => developerTagLabels[tag] || tag);
}

function scoreTone(score) {
  if (score >= 70) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function completenessTone(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 90) return "complete";
  if (value >= 70) return "partial";
  return "low";
}

function hitTone(count) {
  if (count >= 6) return "strong";
  if (count >= 3) return "steady";
  if (count >= 1) return "new";
  return "empty";
}

function SameNameBenchmark({ item }) {
  const reference = item.sameNameLeader;
  const leader = reference?.leader;
  if (reference?.status !== "ready" || !leader) {
    return (
      <section className="same-name-benchmark is-unavailable">
        <div className="same-name-label"><strong>同名最高市值</strong><small>按代码精确匹配</small></div>
        <p>{reference?.status === "empty" ? "未找到可验证的同代码市值样本" : "本轮同名市值查询暂不可用"}</p>
      </section>
    );
  }
  const multiple = Number.isFinite(reference.marketCapMultiple)
    ? reference.marketCapMultiple >= 10 ? reference.marketCapMultiple.toFixed(0) : reference.marketCapMultiple.toFixed(1)
    : null;
  return (
    <section className={`same-name-benchmark ${reference.isCurrent ? "is-current" : ""}`}>
      <div className="same-name-label">
        <strong>同名最高市值</strong>
        <small>按代码精确匹配 · DexScreener</small>
      </div>
      <div className="same-name-main">
        <div><strong>{leader.symbol}</strong><span>{leader.name}</span></div>
        <div><strong>{money(leader.marketCap)}</strong><span>{reference.isCurrent ? "当前币已是第一" : multiple ? `当前币的 ${multiple} 倍` : "同名市值第一"}</span></div>
      </div>
      <div className="same-name-meta">
        <span className={`chain chain-${leader.chain}`}>{leader.chain.toUpperCase()}</span>
        <code title={leader.address}>{shortWallet(leader.address)}</code>
        <span>{reference.matchCount} 枚精确同代码样本</span>
        {leader.pairUrl && <a href={leader.pairUrl} target="_blank" rel="noopener noreferrer">查看对标 <ExternalLinkIcon /></a>}
      </div>
    </section>
  );
}

export default function Inspector({ item, watched, watchBusy, calibration, page, onToggleWatch, onClose }) {
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
  const gmgnAppUrl = gmgnAppIntentUrl(item.chain, item.address);
  const twitterUrl = twitterProfileUrl(item.twitter);
  const kolAverageCost = item.holderAnalysis?.currentKolAverageCost;
  const kolCostGap = Number.isFinite(kolAverageCost) && kolAverageCost > 0 && Number.isFinite(item.price)
    ? item.price / kolAverageCost - 1
    : null;
  const kolEntryMarketCap = Number.isFinite(kolAverageCost) && kolAverageCost > 0 && Number.isFinite(item.price) && item.price > 0 && Number.isFinite(item.marketCap)
    ? item.marketCap * kolAverageCost / item.price
    : null;
  const smartHolderCount = item.holderAnalysis?.currentSmartHolderCount;
  const kolHolderCount = item.holderAnalysis?.currentKolHolderCount;
  const narrative = item.narrative || {
    category: "叙事待扫描",
    categoryKey: "unknown",
    summary: "等待下一轮扫描获取项目简介与叙事线索。",
    source: "unknown",
    sourceLabel: "待扫描",
    completeness: 0
  };
  return (
    <aside className="inspector">
      <div className="mobile-detail-toolbar">
        <button type="button" onClick={onClose} aria-label="返回代币列表">← 返回列表</button>
        <strong>{item.symbol} 详情</strong>
      </div>
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
          <div className={`score-orbit score-${scoreTone(item.score)}`} aria-label={`${item.score} 分`}>
            <strong>{item.score}</strong><span>/100</span>
          </div>
        </div>
      </div>

      <SameNameBenchmark item={item} />

      {item.isLive === false && (
        <div className="stale-watch" role="status">本轮扫描未命中，正在保留收藏时的最后快照。</div>
      )}

      <div className={`strategy-banner strategy-banner-${page.key}`} role="note">
        <strong>{page.key === "discovery" ? "猎星榜 · early-v3" : page.name}</strong>
        <span>{page.key === "discovery" ? "硬过滤：持币地址 >300、市值 $10k–$2M；Rug 风险 ≥0.10 或其他明确跑路信号一票否决，安全数据未完成时仅观察。" : "已将关键风险缺失、关联控盘与高 Bundler 纳入过滤。"}</span>
      </div>

      <div className="contract-block">
        <span>{item.chain.toUpperCase()} · {phaseLabels[item.phase] || item.phase}</span>
        <code title={item.address}>{item.address}</code>
        <button type="button" onClick={copyAddress} aria-label="复制合约地址">
          {copied ? <CheckIcon /> : <CopyIcon />}{copied ? "已复制" : "复制"}
        </button>
      </div>

      <div className={`gmgn-link-actions ${twitterUrl ? "has-twitter" : ""}`}>
        <a className="gmgn-detail-link gmgn-app-action" href={gmgnAppUrl}>
          <ExternalLinkIcon />打开 GMGN App
        </a>
        <a className="gmgn-detail-link gmgn-web-action" href={gmgnUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLinkIcon />打开 GMGN 网页
        </a>
        {twitterUrl && (
          <a className="gmgn-detail-link twitter-action" href={twitterUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon />打开 X / Twitter
          </a>
        )}
      </div>

      <div className="metric-grid">
        <div className="metric-market"><span>市值</span><strong>{money(item.marketCap)}</strong></div>
        <div className="metric-liquidity"><span>流动性</span><strong>{money(item.liquidity)}</strong></div>
        <div className={`safety-metric safety-${item.safetyStatus || "pending"}`}>
          <span>抗跑路安全分</span>
          <strong>{Number.isFinite(item.safetyScore) ? `${item.safetyScore}/100` : "待评估"}</strong>
          <small>{safetyStatus(item.safetyStatus)}</small>
        </div>
        <div className={`metric-completeness completeness-${completenessTone(item.dataCompleteness)}`}>
          <span>数据完整度</span>
          <strong>{Number.isFinite(item.dataCompleteness) ? `${item.dataCompleteness}%` : "—"}</strong>
        </div>
        {watched && (
          <div className={`watch-hit-metric hit-${hitTone(item.watchHitCount || 0)}`}>
            <span>累计命中</span>
            <strong>{item.watchHitCount || 0} 轮</strong>
            <small>收藏后进入 ALERT / WATCH 才累计</small>
          </div>
        )}
      </div>

      <div className="key-signal-strip" aria-label="关键指标速览">
        <span className={`key-signal key-signal-smart ${smartHolderCount > 0 ? "is-active" : "is-empty"}`}>
          聪明钱 <strong>{Number.isFinite(smartHolderCount) ? compact(smartHolderCount) : "—"}</strong>
        </span>
        <span className={`key-signal key-signal-kol ${kolHolderCount > 0 ? "is-active" : "is-empty"}`}>
          KOL <strong>{Number.isFinite(kolHolderCount) ? compact(kolHolderCount) : "—"}</strong>
        </span>
        <span className={`key-signal key-signal-evidence ${(item.evidenceFamilyCount || 0) >= 2 ? "is-active" : "is-empty"}`}>
          独立信号 <strong>{item.evidenceFamilyCount || 0}</strong>
        </span>
        <span className="key-signal key-signal-holder is-active">
          持币地址 <strong>{compact(item.holderCount)}</strong>
        </span>
      </div>

      <section className={`narrative-card narrative-card-${narrative.categoryKey}`}>
        <div className="section-heading-row">
          <h3>代币叙事</h3>
          <div className="narrative-card-tags">
            <span className={`narrative-badge narrative-${narrative.categoryKey}`}>{narrative.category}</span>
            <span className={`narrative-source source-${narrative.source}`}>{narrative.sourceLabel}</span>
          </div>
        </div>
        <p>{narrative.summary}</p>
        <div className="narrative-completeness">
          <span>叙事资料完整度</span>
          <div><i style={{ "--narrative-completeness": `${narrative.completeness || 0}%` }} /></div>
          <strong>{narrative.completeness || 0}%</strong>
        </div>
        <small>
          {narrative.source === "project"
            ? "该内容来自项目方元数据，仅代表其自述，不代表真实性或投资价值。"
            : "当前为有限资料下的主题线索，不用于证明项目真实性或上涨概率。"}
        </small>
      </section>

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
          <h3>开发者钱包与历史战绩</h3>
          <span className="holder-count">{item.holderAnalysis?.devWalletCount ?? "—"} 个</span>
        </div>
        {Array.isArray(item.holderAnalysis?.developerWallets) && (
          <div className="chip-grid dev-summary-grid">
            <div><span>当前仍持仓</span><strong>{item.holderAnalysis.devActiveWalletCount ?? 0} 个</strong></div>
            <div><span>合计持仓</span><strong>{percent(item.holderAnalysis.devHoldingRate)}</strong></div>
            <div><span>KOL / 名人标签</span><strong>{item.holderAnalysis.devRenownedWalletCount ?? 0} 个</strong></div>
            <div><span>已实现利润</span><strong>{signedMoney(item.holderAnalysis.devRealizedProfit)}</strong></div>
          </div>
        )}
        <div className="developer-history-section">
          <div className="section-heading-row developer-history-heading">
            <h4>历史战绩 · ATH Top3</h4>
            <span className="developer-history-total">
              累计 {item.developerHistory?.countIsMinimum ? "≥" : ""}
              {Number.isFinite(item.developerHistory?.totalCreatedCount) ? item.developerHistory.totalCreatedCount : "—"} 币
            </span>
          </div>
          {item.developerHistory?.status === "ready" ? (
            item.developerHistory.topTokens?.length ? (
              <div className="developer-ath-ranking">
                {item.developerHistory.topTokens.map((token, index) => (
                  <a
                    key={token.address}
                    href={gmgnTokenUrl(item.chain, token.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className={`developer-rank rank-${index + 1}`}>{index + 1}</span>
                    <span className="developer-history-token">
                      <strong>{token.symbol}</strong>
                      <small>{token.migrated ? "已迁移" : "未迁移"}{token.cto ? " · CTO" : ""}</small>
                    </span>
                    <span className="developer-ath-value"><small>历史最高市值</small><strong>{money(token.athMarketCap)}</strong></span>
                    <ExternalLinkIcon />
                  </a>
                ))}
              </div>
            ) : <p className="list-empty">GMGN 未返回该开发者的其他历史代币。</p>
          ) : <p className="list-empty">开发者地址或历史发币数据暂时不可用，将在后续扫描中重试。</p>}
          <p className="holder-note">Top3 明确排除当前代币，并按 GMGN 历史最高市值排序；累计数量包含当前代币。</p>
        </div>
        {Array.isArray(item.holderAnalysis?.developerWallets) ? (
          <>
            {item.holderAnalysis.devSockPuppet && (
              <div className="dev-risk-banner">发现 Dev 转出筹码仍在 Top100 钱包中，疑似换马甲继续控盘。</div>
            )}
            {item.holderAnalysis.developerWallets.length ? (
              <div className="dev-wallet-list">
                {item.holderAnalysis.developerWallets.map((wallet) => (
                  <div className="dev-wallet-card" key={wallet.address}>
                    <div className="dev-wallet-head">
                      <div>
                        <strong>{wallet.name || (wallet.role === "creator" ? "主开发者" : "团队钱包")}</strong>
                        <span>{wallet.twitterUsername ? `@${wallet.twitterUsername}` : "未识别公开身份"}</span>
                      </div>
                      <div className="dev-badges">
                        <span>{wallet.role === "creator" ? "Creator" : "Dev Team"}</span>
                        {wallet.isRenowned && <span className="identity-badge">KOL / 名人</span>}
                        {wallet.isSmartMoney && <span className="identity-badge">聪明钱</span>}
                      </div>
                    </div>
                    <button className="dev-wallet-address" type="button" onClick={() => navigator.clipboard.writeText(wallet.address)} title={`点击复制 ${wallet.address}`}>
                      {wallet.address}
                    </button>
                    <div className="dev-wallet-metrics">
                      <span>{wallet.isHolding ? `持仓 ${holderPercent(wallet.amountPercentage)} · ${money(wallet.usdValue)}` : "已清仓"}</span>
                      <span>均价 {tokenPrice(wallet.averageCost)} · 浮盈 {signedPercent(wallet.unrealizedPnl)}</span>
                      <span>已实现 {signedMoney(wallet.realizedProfit)} · 买 {wallet.buyTxCount} / 卖 {wallet.sellTxCount}</span>
                      <span>标签 {developerTags(wallet).join(" · ") || "无附加标签"}</span>
                    </div>
                    {wallet.transferredToTop100 && <div className="dev-transfer-warning">转出目标仍在 Top100：{shortWallet(wallet.transferOutAddress)}</div>}
                  </div>
                ))}
              </div>
            ) : <p className="list-empty">GMGN 未识别到开发者标签钱包；这不代表开发者身份安全或已放弃控制。</p>}
            <p className="holder-note">
              身份与标签来自 GMGN；“KOL / 名人”仅在钱包带 renowned/kol 标签时显示。
              {item.holderAnalysis.developerCoverage === "top100-only" ? " 当前开发者名单仅覆盖 Top100，可能遗漏已清仓钱包。" : " 已包含 GMGN dev 标签查询结果，包括部分已清仓钱包。"}
            </p>
          </>
        ) : <p className="list-empty">等待下一轮深度扫描生成开发者信息。</p>}
      </section>

      <section className="inspector-section">
        <div className="section-heading-row">
          <h3>当前持有的 KOL</h3>
          <span className="holder-count">{item.holderAnalysis?.currentKolHolderCount ?? "—"} 个</span>
        </div>
        {Number.isFinite(kolAverageCost) && kolAverageCost > 0 && (
          <div className="kol-cost-grid">
            <div><span>KOL 加权成本</span><strong>{tokenPrice(kolAverageCost)}</strong></div>
            <div><span>当前价格</span><strong>{tokenPrice(item.price)}</strong></div>
            <div><span>相对 KOL 成本</span><strong className={Number.isFinite(kolCostGap) ? (kolCostGap >= 0 ? "positive-value" : "negative-value") : ""}>{signedPercent(kolCostGap)}</strong></div>
            <div><span>估算建仓市值</span><strong>{money(kolEntryMarketCap)}</strong></div>
            <div><span>成本覆盖率</span><strong>{percent(item.holderAnalysis.currentKolCostCoverage)}</strong></div>
          </div>
        )}
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
                    <span>均价 {tokenPrice(holder.averageCost)}</span>
                    <span>浮盈 {signedPercent(holder.unrealizedPnl)} · 买 {holder.buyTxCount} / 卖 {holder.sellTxCount}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="list-empty">未发现当前余额大于 0 的 GMGN KOL 钱包。</p>
        ) : <p className="list-empty">等待下一轮深度扫描生成 KOL 持仓名单。</p>}
        <p className="holder-note">
          加权成本按当前持仓数量计算；转账或成本未知的仓位不参与成本计算，并反映在覆盖率中。已清仓 KOL 不计入。
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
