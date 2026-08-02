export function money(value) {
  if (!Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  });
  return `$${formatter.format(value)}`;
}

export function compact(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function localTime(value, withSeconds = false) {
  if (!value) return "尚未扫描";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false
  }).format(date);
}

export function creationAge(value, now = Date.now()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "创建时间未知";
  const elapsedSeconds = Math.max(0, Math.floor(now / 1000 - timestamp));
  if (elapsedSeconds < 60) return "刚刚创建";
  if (elapsedSeconds < 3600) return `创建 ${Math.floor(elapsedSeconds / 60)}分钟`;
  if (elapsedSeconds < 86400) return `创建 ${Math.floor(elapsedSeconds / 3600)}小时`;
  if (elapsedSeconds < 30 * 86400) return `创建 ${Math.floor(elapsedSeconds / 86400)}天`;
  if (elapsedSeconds < 365 * 86400) return `创建 ${Math.floor(elapsedSeconds / (30 * 86400))}个月`;
  return `创建 ${Math.floor(elapsedSeconds / (365 * 86400))}年`;
}

export function isCreatedWithin(value, maxAgeSeconds, now = Date.now()) {
  const timestamp = Number(value);
  const limit = Number(maxAgeSeconds);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(limit) || limit <= 0) return false;
  const elapsedSeconds = Math.max(0, now / 1000 - timestamp);
  return elapsedSeconds <= limit;
}

export function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

export const phaseLabels = {
  EARLY: "早期",
  BREAKOUT: "突破",
  LATE: "后段",
  WATCHING: "观察"
};

export const familyLabels = {
  market: "市场活跃",
  attention: "搜索热度",
  "smart-money": "聪明钱",
  "kol-social": "KOL / 社交",
  "gmgn-signal": "GMGN 信号"
};
