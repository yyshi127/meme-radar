import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Filters from "./components/Filters.jsx";
import Header from "./components/Header.jsx";
import Inspector from "./components/Inspector.jsx";
import Summary from "./components/Summary.jsx";
import TokenTable from "./components/TokenTable.jsx";
import { isCreatedWithin } from "./lib/format.js";

const defaultFilters = { priority: "focus", chain: "all", phase: "all", createdWithin: "all", query: "" };
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

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok && response.status !== 202) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default function App() {
  const [pageKey, setPageKey] = useState(() => window.location.pathname === pages.safety.path ? pages.safety.key : pages.discovery.key);
  const page = pages[pageKey];
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedKey, setSelectedKey] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [watchBusyKey, setWatchBusyKey] = useState(null);
  const [error, setError] = useState(null);
  const refreshingRef = useRef(false);
  const hasReportRef = useRef(false);
  const reportFailureCountRef = useRef(0);
  const reportGeneratedAtRef = useRef(null);
  const statusSignatureRef = useRef("");
  const watchlistSignatureRef = useRef("");

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const [statusResult, watchlistResult] = await Promise.allSettled([
        api("/api/status"),
        api("/api/watchlist")
      ]);
      if (statusResult.status === "fulfilled") {
        const signature = JSON.stringify(statusResult.value);
        if (signature !== statusSignatureRef.current) {
          statusSignatureRef.current = signature;
          setStatus(statusResult.value);
        }
      }

      const completedAt = statusResult.status === "fulfilled" ? statusResult.value?.lastCompletedAt : null;
      const shouldFetchReport = !hasReportRef.current
        || statusResult.status === "rejected"
        || (completedAt && completedAt !== reportGeneratedAtRef.current);
      let reportResult = { status: "skipped" };
      if (shouldFetchReport) {
        try {
          reportResult = { status: "fulfilled", value: await api("/api/report") };
        } catch (reason) {
          reportResult = { status: "rejected", reason };
        }
      }

      if (reportResult.status === "fulfilled" && reportResult.value?.candidates) {
        const generatedAt = reportResult.value.generatedAt || completedAt || null;
        if (!hasReportRef.current || generatedAt !== reportGeneratedAtRef.current) {
          reportGeneratedAtRef.current = generatedAt;
          setReport(reportResult.value);
        }
        hasReportRef.current = true;
        reportFailureCountRef.current = 0;
      } else if (reportResult.status === "rejected") {
        reportFailureCountRef.current += 1;
      }
      if (watchlistResult.status === "fulfilled" && watchlistResult.value?.items) {
        const signature = JSON.stringify(watchlistResult.value.items);
        if (signature !== watchlistSignatureRef.current) {
          watchlistSignatureRef.current = signature;
          setWatchlist(watchlistResult.value.items);
        }
      }

      const attemptedResults = [statusResult, watchlistResult];
      if (reportResult.status !== "skipped") attemptedResults.push(reportResult);
      const failures = attemptedResults.filter((result) => result.status === "rejected");
      const unauthorized = failures.some((result) => result.reason?.status === 401);
      if (unauthorized) {
        setError({ message: "登录状态已失效，请重新连接雷达。", reconnect: true });
      } else if (failures.length === attemptedResults.length) {
        setError({ message: "暂时无法连接雷达，正在保留上次成功读取的数据。", reconnect: false });
      } else if (reportResult.status === "rejected" && (!hasReportRef.current || reportFailureCountRef.current >= 3)) {
        setError({ message: `雷达数据读取不稳定：${reportResult.reason.message}，正在显示上次数据。`, reconnect: false });
      } else {
        setError(null);
      }
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  useEffect(() => {
    document.title = `${page.name} · Meme Radar`;
  }, [page.name]);

  useEffect(() => {
    function syncPageFromHistory() {
      setPageKey(window.location.pathname === pages.safety.path ? pages.safety.key : pages.discovery.key);
      setMobileDetailOpen(false);
    }
    window.addEventListener("popstate", syncPageFromHistory);
    return () => window.removeEventListener("popstate", syncPageFromHistory);
  }, []);

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
    const scanTime = report?.generatedAt ? Date.parse(report.generatedAt) : Date.now();
    return source.filter((item) => {
      if (filters.priority === "focus" && !["ALERT", "WATCH"].includes(item.priority)) return false;
      if (!["focus", "all", "saved"].includes(filters.priority) && item.priority !== filters.priority) return false;
      if (filters.chain !== "all" && item.chain !== filters.chain) return false;
      if (filters.phase !== "all" && item.phase !== filters.phase) return false;
      if (filters.createdWithin !== "all" && !isCreatedWithin(item.creationTimestamp, filters.createdWithin, scanTime)) return false;
      if (query && !`${item.symbol} ${item.name} ${item.address}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [candidates, filters, report?.generatedAt, watchedCandidates]);

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
      const nextWatchlist = result.items || [];
      watchlistSignatureRef.current = JSON.stringify(nextWatchlist);
      setWatchlist(nextWatchlist);
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

  function navigatePage(nextPage) {
    if (nextPage.key === page.key) return;
    window.history.pushState({}, "", nextPage.path);
    setPageKey(nextPage.key);
    setMobileDetailOpen(false);
  }

  const errorMessage = typeof error === "string" ? error : error?.message;

  return (
    <main className="app-shell">
      <Header page={page} pages={pages} status={status} generatedAt={report?.generatedAt} onNavigate={navigatePage} onScan={runScan} />
      <Summary page={page} candidates={candidates} errorCount={report?.errors?.length || 0} />
      {errorMessage && (
        <div className="app-error" role="alert">
          <span>{errorMessage}</span>
          {error?.reconnect && <button type="button" onClick={() => window.location.reload()}>重新连接</button>}
        </div>
      )}
      <Filters filters={filters} onChange={setFilters} resultCount={filtered.length} />
      <div className={`workspace ${mobileDetailOpen ? "mobile-detail-visible" : ""}`}>
        <TokenTable
          items={filtered}
          selectedKey={selectedKey}
          watchedKeys={watchedKeys}
          showWatchHits={filters.priority === "saved"}
          watchBusyKey={watchBusyKey}
          onSelect={selectCandidate}
          onToggleWatch={toggleWatch}
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
