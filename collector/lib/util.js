// Small shared helpers. No dependencies.

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const warn = (...a) => console.warn(new Date().toISOString().slice(11, 19), "WARN", ...a);

/** fetch wrapper with timeout, one retry on network/5xx/429, and JSON/text helpers. Swappable for tests. */
let fetchImpl = (...a) => globalThis.fetch(...a);
export function setFetch(fn) { fetchImpl = fn; }

export async function http(url, { method = "GET", headers = {}, body, timeoutMs = 20000, as = "json", retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`${method} ${redact(url)} → HTTP ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      if (as === "text") return text;
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Hide API keys in logged URLs. */
export function redact(url) {
  return String(url).replace(/([?&](?:key|api_key|token)=)[^&]+/gi, "$1***");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** YYYY-MM-DD for a Date in the given IANA timezone. */
export function ymdIn(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Sep 17" for a Date in the given timezone (matches what the website checks for its Today pill). */
export function monDayIn(date, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(date);
}

/** "Thu Sep 17, 2026 · 9:02 AM ET" */
export function stampIn(date, tz) {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
  return `${d.replace(",", "")} · ${t} ET`;
}

export function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 duration (PT1H2M3S) → seconds. */
export function isoDurationToSec(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s || "");
  if (!m) return 0;
  const [, d = 0, h = 0, mi = 0, se = 0] = m.map((x) => (x === undefined ? 0 : Number(x)));
  return d * 86400 + h * 3600 + mi * 60 + se;
}

export function fmtDuration(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function compact(n) {
  if (n == null || Number.isNaN(n)) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** Lowercase alphanumerics only — used to compare titles loosely. */
export const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

export function youtubeId(url) {
  const m = String(url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function canonicalUrl(url) {
  const id = youtubeId(url);
  if (id) return `yt:${id}`;
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$/.test(k)) u.searchParams.delete(k);
    return (u.hostname.replace(/^(www|m|old)\./, "") + u.pathname.replace(/\/+$/, "") + (u.search || "")).toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^(www|m|old)\./, ""); } catch { return ""; }
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** HTML (possibly entity-escaped, as in RSS descriptions) → plain text. */
export const stripTags = (s) =>
  decodeEntities(decodeEntities(String(s || "")).replace(/<[^>]+>/g, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
