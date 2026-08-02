const TWITTER_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const TWITTER_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export function twitterProfileUrl(value) {
  const text = String(value || "").trim();
  if (!text || text === "?") return null;
  const handle = text.replace(/^@/, "");
  if (TWITTER_HANDLE.test(handle)) return `https://x.com/${handle}`;

  try {
    const url = new URL(text);
    if (!TWITTER_HOSTS.has(url.hostname.toLowerCase()) || !url.pathname || url.pathname === "/") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}
