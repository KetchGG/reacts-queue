// RSS/Atom feeds and Blizzard's news page. No API keys needed.
import { http, decodeEntities, stripTags } from "./util.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; xaryu-react-queue/1.0; +https://github.com)" };

/** Minimal RSS 2.0 / Atom parser — enough for news feeds. */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const tag = (name) => {
      const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
      return m ? decodeEntities(m[1]).trim() : "";
    };
    let link = tag("link");
    if (!link) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? decodeEntities(alt[1]) : "";
    }
    const date = tag("pubDate") || tag("published") || tag("updated") || tag("dc:date");
    const img =
      (b.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i) || [])[1] ||
      (b.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i) || [])[1] ||
      (decodeEntities(b).match(/<img[^>]*src=["']([^"']+)["']/i) || [])[1] || "";
    const title = stripTags(tag("title"));
    if (!title || !link) continue;
    items.push({
      title,
      link: link.trim(),
      publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : "",
      summary: stripTags(tag("description") || tag("summary") || tag("content")).slice(0, 300),
      image: img ? decodeEntities(img) : "",
    });
  }
  return items;
}

export async function fetchFeed(url) {
  const xml = await http(url, { as: "text", headers: { ...UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  return parseFeed(xml);
}

/**
 * Blizzard's WoW news page has no feed. Pull article links (…/news/<id>/<slug>) from the HTML.
 * No dates on the list page, so the collector treats ids it hasn't seen before as new.
 */
export function parseBlizzardNews(html, base) {
  const out = new Map();
  const re = /<a\b[^>]*href=["']([^"']*\/news\/(\d{6,})(?:\/([a-z0-9-]+))?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, href, id, slug, inner] = m;
    if (out.has(id)) continue;
    const heading = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || inner.match(/<[^>]+class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    let title = stripTags(heading ? heading[1] : inner);
    if (!title || title.length < 8) title = slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
    if (!title) continue;
    const url = href.startsWith("http") ? href : new URL(href, base.replace(/\/?$/, "/")).href;
    const img = (inner.match(/<img[^>]*src=["']([^"']+)["']/i) || [])[1] || "";
    out.set(id, { id, title: title.slice(0, 200), link: url, image: img ? decodeEntities(img) : "" });
  }
  return [...out.values()];
}

export async function fetchBlizzardNews(url, base) {
  const html = await http(url, { as: "text", headers: { ...UA, Accept: "text/html" } });
  return parseBlizzardNews(html, base || url);
}
