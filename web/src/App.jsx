import { useCallback, useEffect, useMemo, useState } from "react";
import Filters from "./components/Filters.jsx";
import Header from "./components/Header.jsx";
import Inspector from "./components/Inspector.jsx";
import Summary from "./components/Summary.jsx";
import TokenTable from "./components/TokenTable.jsx";

const defaultFilters = { priority: "focus", chain: "all", phase: "all", query: "" };
const pages = {
  discovery: {
    key: "discovery",
    name: "猎星榜",
    subtitle: "早期优势策略 · early-v3",
    path: "/discovery"
  },
  safety: {
    key: "safety",
    name: "验金榜",
    subtitle: "Top100 与合约安全严格确认",
    path: "/verified"
  }
};

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok && response.status !== 202) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export default function App() {
  const page = window.location.pathname === pages.safety.path ? pages.safety : pages.discovery;
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedKey, setSelectedKey] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [watchBusyKey, setWatchBusyKey] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextReport, nextWatchlist] = await Promise.all([
        api("/api/status"),
        api("/api/report"),
        api("/api/watchlist")
      ]);
      setStatus(nextStatus);
      if (nextReport?.candidates) setReport(nextReport);
      if (nextWatchlist?.items) setWatchlist(nextWatchlist.items);
      setError(null);
    } catch (requestError) {
      setError(`无法读取本地雷达：${requestError.message}`);
    }
  }, []);

  useEffect(() => {
    document.title = `${page.name} · Meme Radar`;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [page.name, refresh]);

  useEffect(() => {
    document.body.classList.toggle("mobile-detail-open", mobileDetailOpen);
    function closeOnEscape(event) {
      if (event.key === "Escape") setMobileDetailOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("mobile-detail-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileDetailOpen]);

  const candidates = page.key === "discovery"
    ? report?.discoveryCandidates || report?.candidates || []
    : report?.candidates || [];
  const watchedCandidates = useMemo(() => {
    const current = new Map(candidates.map((candidate) => [candidate.key, candidate]));
    return watchlist.map((entry) => current.has(entry.key)
      ? { ...current.get(entry.key), watched: true, isLive: true, watchHitCount: entry.hitCount || 0 }
      : entry.snapshot);
  }, [candidates, watchlist]);
  const watchedKeys = useMemo(() => new Set(watchlist.map((entry) => entry.key)), [watchlist]);
  const watchEntries = useMemo(() => new Map(watchlist.map((entry) => [entry.key, entry])), [watchlist]);
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const source = filters.priority === "saved" ? watchedCandidates : candidates;
    return source.filter((item) => {
      if (filters.priority === "focus" && !["ALERT", "WATCH"].includes(item.priority)) return false;
      if (!["focus", "all", "saved"].includes(filters.priority) && item.priority !== filters.priority) return false;
      if (filters.chain !== "all" && item.chain !== filters.chain) return false;
      if (filters.phase !== "all" && item.phase !== filters.phase) return false;
      if (query && !`${item.symbol} ${item.name} ${item.address}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [candidates, filters, watchedCandidates]);

  useEffect(() => {
    const stillVisible = filtered.some((item) => item.key === selectedKey);
    if (!stillVisible) setSelectedKey(filtered[0]?.key || null);
  }, [filtered, selectedKey]);

  const selectedCandidate = filtered.find((item) => item.key === selectedKey)
    || candidates.find((item) => item.key === selectedKey)
    || watchedCandidates.find((item) => item.key === selectedKey)
    || null;
  const selectedWatchEntry = selectedCandidate ? watchEntries.get(selectedCandidate.key) : null;
  const selected = selectedCandidate && selectedWatchEntry
    ? { ...selectedCandidate, watched: true, watchHitCount: selectedWatchEntry.hitCount || 0 }
    : selectedCandidate;

  function selectCandidate(item) {
    setSelectedKey(item.key);
    setMobileDetailOpen(true);
  }

  async function toggleWatch(item) {
    const watched = watchedKeys.has(item.key);
    setWatchBusyKey(item.key);
    try {
      const result = watched
        ? await api(`/api/watchlist?chain=${encodeURIComponent(item.chain)}&address=${encodeURIComponent(item.address)}`, { method: "DELETE" })
        : await api("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain: item.chain, address: item.address })
        });
      setWatchlist(result.items || []);
      setError(null);
    } catch (requestError) {
      setError(`无法更新收藏：${requestError.message}`);
    } finally {
      setWatchBusyKey(null);
    }
  }

  async function runScan() {
    try {
      await api("/api/scan", { method: "POST" });
      setStatus((value) => ({ ...value, scanning: true }));
      setError(null);
    } catch (requestError) {
      setError(`无法启动扫描：${requestError.message}`);
    }
  }

  return (
    <main className="app-shell">
      <Header page={page} pages={pages} status={status} generatedAt={report?.generatedAt} onScan={runScan} />
      <Summary page={page} candidates={candidates} errorCount={report?.errors?.length || 0} />
      {error && <div className="app-error" role="alert">{error}</div>}
      <Filters filters={filters} onChange={setFilters} resultCount={filtered.length} />
      <div className={`workspace ${mobileDetailOpen ? "mobile-detail-visible" : ""}`}>
        <TokenTable
          items={filtered}
          selectedKey={selectedKey}
          watchedKeys={watchedKeys}
          showWatchHits={filters.priority === "saved"}
          onSelect={selectCandidate}
        />
        <Inspector
          item={selected}
          watched={selected ? watchedKeys.has(selected.key) : false}
          watchBusy={selected?.key === watchBusyKey}
          calibration={report?.calibration}
          page={page}
          onToggleWatch={toggleWatch}
          onClose={() => setMobileDetailOpen(false)}
        />
      </div>
      <footer className="statusbar">
        <span>{["127.0.0.1", "localhost"].includes(window.location.hostname) ? "只读模式 · 本机访问" : "登录保护 · 私有实例"}</span>
        <span>{status?.scanning ? "GMGN 数据更新中" : `自动扫描间隔 ${status?.intervalSeconds || 300} 秒`}</span>
      </footer>
    </main>
  );
}
