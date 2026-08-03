import { useEffect, useRef } from "react";
import { shortAddress } from "../lib/format.js";

export default function ConfirmWatchRemoval({ item, busy, onCancel, onConfirm }) {
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    if (!item) return undefined;
    cancelButtonRef.current?.focus();
    function closeOnEscape(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, item, onCancel]);

  if (!item) return null;
  const displayName = item.name && item.name !== "?" ? item.name : "未提供名称";

  return (
    <div
      className="watch-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="watch-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="watch-confirm-title"
        aria-describedby="watch-confirm-description"
      >
        <div className="watch-confirm-icon" aria-hidden="true">!</div>
        <div className="watch-confirm-copy">
          <span>重点观察</span>
          <h2 id="watch-confirm-title">确认移除 {item.symbol}？</h2>
          <p id="watch-confirm-description">移除后将不再累计收藏命中次数，但代币仍可能出现在普通榜单中。</p>
        </div>
        <div className="watch-confirm-token">
          <strong>{item.symbol}</strong>
          <span>{displayName}</span>
          <code>{String(item.chain || "").toUpperCase()} · {shortAddress(item.address)}</code>
        </div>
        <div className="watch-confirm-actions">
          <button ref={cancelButtonRef} type="button" className="watch-confirm-cancel" onClick={onCancel} disabled={busy}>保留收藏</button>
          <button type="button" className="watch-confirm-remove" onClick={onConfirm} disabled={busy}>
            {busy ? "正在移除…" : "确认移除"}
          </button>
        </div>
      </section>
    </div>
  );
}
