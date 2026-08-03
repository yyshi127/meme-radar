import { useEffect, useState } from "react";
import { RefreshIcon } from "./Icons.jsx";
import { localTime } from "../lib/format.js";

function countdownLabel(nextScheduledAt, now) {
  const target = Date.parse(nextScheduledAt);
  if (!Number.isFinite(target)) return "下次扫描 --:--";
  const remaining = Math.max(0, Math.ceil((target - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return remaining ? `下次扫描 ${minutes}:${String(seconds).padStart(2, "0")}` : "即将开始扫描";
}

function ScanCountdown({ nextScheduledAt }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <small className="scan-countdown">{countdownLabel(nextScheduledAt, now)}</small>;
}

export default function Header({ page, pages, status, generatedAt, onNavigate, onScan }) {
  const scanning = Boolean(status?.scanning);
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <h1>Meme Radar</h1>
          <p>{page.name} · {page.subtitle}</p>
        </div>
      </div>
      <nav className="page-nav" aria-label="雷达榜单">
        {Object.values(pages).map((item) => (
          <a
            key={item.key}
            href={item.path}
            className={page.key === item.key ? "active" : ""}
            aria-current={page.key === item.key ? "page" : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(item);
            }}
          >
            <strong>{item.name}</strong>
            <small>{item.key === "discovery" ? "先发现" : "再验证"}</small>
          </a>
        ))}
      </nav>
      <div className="topbar-actions">
        <div className="sync-state" aria-live="polite">
          <span className={`status-dot ${scanning ? "is-scanning" : ""}`} />
          <div>
            <strong>{scanning ? "正在扫描" : "数据已同步"}</strong>
            <span>{localTime(generatedAt, true)}</span>
          </div>
        </div>
        <div className="scan-action-stack">
          <button className="scan-button" type="button" onClick={onScan} disabled={scanning}>
            <RefreshIcon spinning={scanning} />
            {scanning ? "扫描中" : "立即扫描"}
          </button>
          <ScanCountdown nextScheduledAt={status?.nextScheduledAt} />
        </div>
      </div>
    </header>
  );
}
