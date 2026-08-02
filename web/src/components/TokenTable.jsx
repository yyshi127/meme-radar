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

export default function TokenTable({ items, selectedKey, watchedKeys, onSelect }) {
  return (
    <div className="table-region">
      <table>
        <thead>
          <tr>
            <th>优先级</th>
            <th className="number">分数</th>
            <th>代币</th>
            <th>链</th>
            <th>阶段</th>
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
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(item);
              }}
              tabIndex="0"
            >
              <td><Priority value={item.priority} /></td>
              <td className="number score-cell"><strong>{item.score}</strong><span style={{ "--score": item.score }} /></td>
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
                      {watchedKeys.has(item.key) && <span className="watched-mark" title="已收藏"><StarIcon filled /></span>}
                      <ExternalLinkIcon />
                    </span>
                    <span title={item.address}>{item.name !== "?" ? item.name : shortAddress(item.address)}</span>
                  </a>
                </div>
              </td>
              <td><span className={`chain chain-${item.chain}`}>{item.chain.toUpperCase()}</span></td>
              <td><span className={`phase phase-${item.phase.toLowerCase()}`}>{phaseLabels[item.phase] || item.phase}</span></td>
              <td className="number">{money(item.marketCap)}</td>
              <td className="number">{money(item.liquidity)}</td>
              <td className="number">{compact(item.holderCount)}</td>
              <td className="number signal-number">{currentHolderCount(item, "currentSmartHolderCount")}</td>
              <td className="number">{currentHolderCount(item, "currentKolHolderCount")}</td>
              <td className="number">{item.evidenceFamilyCount || 0}</td>
              <td><Verification status={item.verificationStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <div className="empty-state">
          <strong>没有匹配的候选</strong>
          <span>调整筛选条件，或等待下一轮扫描。</span>
        </div>
      )}
    </div>
  );
}
