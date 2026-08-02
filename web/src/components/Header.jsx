import { RefreshIcon } from "./Icons.jsx";
import { localTime } from "../lib/format.js";
import InstallApp from "./InstallApp.jsx";

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
        <InstallApp />
        <div className="sync-state" aria-live="polite">
          <span className={`status-dot ${scanning ? "is-scanning" : ""}`} />
          <div>
            <strong>{scanning ? "正在扫描" : "数据已同步"}</strong>
            <span>{localTime(generatedAt, true)}</span>
          </div>
        </div>
        <button className="scan-button" type="button" onClick={onScan} disabled={scanning}>
          <RefreshIcon spinning={scanning} />
          {scanning ? "扫描中" : "立即扫描"}
        </button>
      </div>
    </header>
  );
}
