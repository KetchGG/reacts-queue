// Offline tests: every HTTP call is answered by the fake router below.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { setFetch, isoDurationToSec, canonicalUrl, youtubeId, ymdIn, monDayIn, stripTags } from "../lib/util.js";
import { parseFeed, parseBlizzardNews } from "../lib/feeds.js";
import { isShort } from "../lib/youtube.js";
import { guessCat, sanitizeList, rulesRank } from "../lib/rank.js";

const NOW = new Date("2026-09-17T13:00:00Z"); // 9 AM ET
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();

test("helpers", () => {
  assert.equal(isoDurationToSec("PT1H2M3S"), 3723);
  assert.equal(isoDurationToSec("PT45S"), 45);
  assert.equal(youtubeId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assert.equal(youtubeId("https://youtu.be/abcdefghijk?t=3"), "abcdefghijk");
  assert.equal(canonicalUrl("https://www.youtube.com/watch?v=abcdefghijk&t=1"), "yt:abcdefghijk");
  assert.equal(canonicalUrl("https://www.Wowhead.com/news=1/x/?utm_source=a#c"), "wowhead.com/news=1/x");
  assert.equal(ymdIn(NOW, "America/New_York"), "2026-09-17");
  assert.equal(ymdIn(new Date("2026-09-17T02:00:00Z"), "America/New_York"), "2026-09-16");
  assert.equal(monDayIn(NOW, "America/New_York"), "Sep 17");
  assert.equal(stripTags("&lt;p&gt;Hello &amp;amp; <b>bye</b>&lt;/p&gt;"), "Hello & bye");
  assert.equal(isShort({ durationSec: 45, title: "x" }), true);
  assert.equal(isShort({ durationSec: 150, title: "x #shorts" }), true);
  assert.equal(isShort({ durationSec: 150, title: "x" }), false);
  assert.equal(guessCat("WoW Forever beta is live"), "forever");
  assert.equal(guessCat("Hardcore deaths compilation"), "classic");
  assert.equal(guessCat("Midnight season 3 patch notes"), "blizzard");
  assert.equal(guessCat("GTA 6 trailer"), "variety");
});

test("RSS and Atom parsing", () => {
  const rss = `<rss><channel><item><title><![CDATA[Forever beta &amp; more]]></title><link>https://a.com/1</link>
    <pubDate>Wed, 16 Sep 2026 20:00:00 +0000</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description>
    <media:content url="https://a.com/i.jpg"/></item></channel></rss>`;
  const [a] = parseFeed(rss);
  assert.equal(a.title, "Forever beta & more");
  assert.equal(a.link, "https://a.com/1");
  assert.equal(a.publishedAt, "2026-09-16T20:00:00.000Z");
  assert.equal(a.summary, "Hi");
  assert.equal(a.image, "https://a.com/i.jpg");
  const atom = `<feed><entry><title>T</title><link rel="alternate" href="https://b.com/2"/><updated>2026-09-16T10:00:00Z</updated></entry></feed>`;
  assert.equal(parseFeed(atom)[0].link, "https://b.com/2");
});

test("Blizzard news page parsing", () => {
  const html = `<a href="/en-us/news/24304071/world-of-warcraft-forever-found-photos-panel-recap"><img src="https://x/y.jpg"><h3>World of Warcraft: Forever Found Photos Panel Recap</h3><p>2 days ago</p></a>
    <a href="https://worldofwarcraft.blizzard.com/en-us/news/24301145/round-up">Read</a>
    <a href="/en-us/news/24304071/dup">dup</a>`;
  const items = parseBlizzardNews(html, "https://worldofwarcraft.blizzard.com/en-us");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "World of Warcraft: Forever Found Photos Panel Recap");
  assert.equal(items[0].link, "https://worldofwarcraft.blizzard.com/en-us/news/24304071/world-of-warcraft-forever-found-photos-panel-recap");
  assert.equal(items[1].title, "Round Up");
});

test("sanitizeList keeps series, drops unknown refs and duplicates, caps size", () => {
  const cands = [
    { ref: "c1", series: "Hardcore Moments #386", cat: "classic", title: "HCM", metrics: {} },
    { ref: "c2", cat: "forever", title: "A", metrics: {} },
    { ref: "c3", cat: "forever", title: "B", metrics: {} },
  ];
  const out = sanitizeList({ headline: "h", items: [
    { ref: "c2", tier: "legendary", cat: "nope", why: "w" }, { ref: "c2", tier: "epic", cat: "forever", why: "dup" },
    { ref: "zzz", tier: "epic", cat: "forever", why: "x" }, { ref: "c3", tier: "rare", cat: "mmo", why: "" },
  ] }, cands, { max: 1 });
  assert.deepEqual(out.items.map((i) => i.ref), ["c1", "c2"]);
  assert.equal(out.items[1].tier, "rare");
  assert.equal(out.items[1].cat, "forever");
  const r = rulesRank(cands.map((c, i) => ({ ...c, score: 10 - i })), { max: 5 });
  assert.equal(r.items[0].ref, "c1");
});

// ---------------------------------------------------------------- end-to-end with fake APIs
function fakeWorld({ claudeFails = false } = {}) {
  const calls = { writes: [], claudeBodies: [], discord: [], yt: [] };
  const channels = {
    ClassicHardcoreMoments: { id: "UCgA_9xZNJ7_cHYUaswLGcag", title: "Classic Hardcore Moments" },
    WoWForeverMomentsYT: { id: "UCYG7yOvrZV0Bja6EjImcAuQ", title: "WoW: Forever Moments" },
    Warcraft: { id: "UCbLj9QP9FAaHs_647QckGtg", title: "World of Warcraft" },
    Xaryu: { id: "UCxaryuxaryuxaryuxaryu01", title: "Xaryu" },
    Wowhead: { id: "UC8hLeDz9mD4dUrkvXjH9rjw", title: "Wowhead" },
  };
  const uploads = {
    UUgA_9xZNJ7_cHYUaswLGcag: [["hcm386", "Classic Hardcore Moments #386", 20], ["hcm385", "Classic Hardcore Moments #385", 50], ["hcm384", "Classic Hardcore Moments #384", 400]],
    UUbLj9QP9FAaHs_647QckGtg: [["wowbeta0001", "World of Warcraft: Forever | Beta Launch", 5], ["oldtrailer1", "Old trailer", 200]],
    UUxaryuxaryuxaryuxaryu01: [["react000001", "Xaryu Reacts to Classic Hardcore Moments #385", 10]],
    UU8hLeDz9mD4dUrkvXjH9rjw: [["whvideo0001", "Forever beta: everything we know", 8]],
    UUYG7yOvrZV0Bja6EjImcAuQ: [],
  };
  const vid = (id, title, hoursAgo, channelId, channelTitle, extra = {}) => ({
    id, snippet: { title, description: "desc", channelId, channelTitle, publishedAt: iso(hoursAgo), thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } }, defaultAudioLanguage: "en" },
    contentDetails: { duration: extra.duration || "PT10M" }, statistics: { viewCount: String(extra.views ?? 50000), commentCount: "100" }, status: { embeddable: true },
  });
  const videos = {
    "hcm386": vid("hcm386", "Classic Hardcore Moments #386", 20, channels.ClassicHardcoreMoments.id, "Classic Hardcore Moments"),
    "hcm385": vid("hcm385", "Classic Hardcore Moments #385", 50, channels.ClassicHardcoreMoments.id, "Classic Hardcore Moments"),
    "hcm384": vid("hcm384", "Classic Hardcore Moments #384", 400, channels.ClassicHardcoreMoments.id, "Classic Hardcore Moments"),
    "wowbeta0001": vid("wowbeta0001", "World of Warcraft: Forever | Beta Launch", 5, channels.Warcraft.id, "World of Warcraft", { views: 300000 }),
    "whvideo0001": vid("whvideo0001", "Forever beta: everything we know", 8, channels.Wowhead.id, "Wowhead"),
    "short000001": vid("short000001", "He died to a murloc #shorts", 6, "UCsomeoneelse00000000001", "Clipper", { duration: "PT40S", views: 90000 }),
    "lowviews001": vid("lowviews001", "tiny video", 6, "UCsomeoneelse00000000002", "Nobody", { views: 12 }),
  };

  const route = async (url, opts = {}) => {
    const u = new URL(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const text = (t, status = 200) => new Response(t, { status });
    if (u.hostname === "www.googleapis.com") {
      calls.yt.push(u.pathname.split("/").pop());
      const p = u.searchParams;
      if (u.pathname.endsWith("/channels")) {
        if (p.get("forHandle")) {
          const c = channels[p.get("forHandle")];
          return json({ items: c ? [{ id: c.id, snippet: { title: c.title, thumbnails: { default: { url: `https://yt3/${c.id}` } } }, contentDetails: { relatedPlaylists: { uploads: "UU" + c.id.slice(2) } } }] : [] });
        }
        return json({ items: p.get("id").split(",").map((id) => ({ id, snippet: { title: id, thumbnails: { default: { url: `https://yt3/${id}` } } } })) });
      }
      if (u.pathname.endsWith("/playlistItems")) {
        return json({ items: (uploads[p.get("playlistId")] || []).map(([id, title, h]) => ({ snippet: { title, publishedAt: iso(h) }, contentDetails: { videoId: id, videoPublishedAt: iso(h) } })) });
      }
      if (u.pathname.endsWith("/search")) {
        return json({ items: p.get("videoDuration") === "short" ? [{ id: { videoId: "short000001" } }] : [{ id: { videoId: "lowviews001" } }, { id: { videoId: "whvideo0001" } }] });
      }
      if (u.pathname.endsWith("/videos")) return json({ items: p.get("id").split(",").map((id) => videos[id]).filter(Boolean) });
    }
    if (u.hostname === "www.reddit.com" && u.pathname === "/api/v1/access_token") return json({ access_token: "tok" });
    if (u.hostname === "oauth.reddit.com") {
      const sub = u.pathname.split("/")[2];
      if (sub === "classicwow") {
        return json({ data: { children: [
          { data: { id: "a1", subreddit: "classicwow", title: "Blizzard just confirmed Forever server list", permalink: "/r/classicwow/comments/a1/x/", is_self: true, score: 2300, num_comments: 400, created_utc: (NOW - 5 * 3600e3) / 1000 } },
          { data: { id: "a2", subreddit: "classicwow", title: "Beta trailer thread", permalink: "/r/classicwow/comments/a2/y/", is_self: false, url: "https://www.youtube.com/watch?v=wowbeta0001", domain: "youtube.com", score: 900, num_comments: 80, created_utc: (NOW - 4 * 3600e3) / 1000 } },
          { data: { id: "a3", subreddit: "classicwow", title: "low score", permalink: "/r/classicwow/comments/a3/z/", is_self: true, score: 3, created_utc: (NOW - 1 * 3600e3) / 1000 } },
          { data: { id: "a4", subreddit: "classicwow", title: "Weekly thread", permalink: "/r/classicwow/comments/a4/w/", stickied: true, score: 5000, created_utc: (NOW - 1 * 3600e3) / 1000 } },
        ] } });
      }
      return json({ data: { children: [] } });
    }
    if (u.hostname === "www.wowhead.com") {
      return text(`<rss><channel>
        <item><title>Forever Beta Patch Notes</title><link>https://www.wowhead.com/news=1/forever-beta-patch-notes</link><pubDate>${new Date(NOW - 3 * 3600e3).toUTCString()}</pubDate><description>notes</description></item>
        <item><title>Ancient story</title><link>https://www.wowhead.com/news=0/old</link><pubDate>${new Date(NOW - 99 * 3600e3).toUTCString()}</pubDate></item>
        <item><title>Already listed yesterday</title><link>https://www.wowhead.com/news=5/listed</link><pubDate>${new Date(NOW - 20 * 3600e3).toUTCString()}</pubDate></item>
      </channel></rss>`);
    }
    if (u.hostname === "blizzardwatch.com") return text("<rss><channel></channel></rss>");
    if (u.hostname === "massivelyop.com") return text("", 503);
    if (u.hostname === "www.pcgamer.com") return text(`<rss><channel><item><title>Some unrelated hardware deal</title><link>https://www.pcgamer.com/deal</link><pubDate>${new Date(NOW - 2 * 3600e3).toUTCString()}</pubDate></item></channel></rss>`);
    if (u.hostname === "worldofwarcraft.blizzard.com") {
      return text(`<a href="/en-us/news/24309999/wow-forever-beta-now-live"><h3>WoW Forever Beta Now Live</h3></a><a href="/en-us/news/24304071/old-news"><h3>Old news already seen</h3></a>`);
    }
    if (u.hostname === "api.anthropic.com") {
      const body = JSON.parse(opts.body);
      calls.claudeBodies.push(body);
      if (claudeFails) return json({ error: { message: "overloaded" } }, 529);
      const refs = [...body.messages[0].content.matchAll(/"ref":"(c\d+)"/g)].map((m) => m[1]);
      return json({ content: [{ type: "tool_use", name: "publish_list", input: {
        headline: "Forever beta is live.",
        items: refs.filter((r) => r !== "c1").map((ref, i) => ({ ref, tier: i === 0 ? "epic" : "rare", cat: "forever", why: `because ${ref}` })),
      } }], usage: { input_tokens: 1000, output_tokens: 200 } });
    }
    if (u.hostname === "db.example.supabase.co") {
      const tbl = u.pathname.split("/").pop();
      if ((opts.method || "GET") === "GET") {
        if (tbl === "settings") return json([{ value: { text: "more hardcore please" } }]);
        if (tbl === "days" && u.searchParams.get("order")) return json([{ date: "2026-09-16", items: [{ id: "260916-01", url: "https://www.wowhead.com/news=5/listed", title: "Skyborne drama" }] }]);
        if (tbl === "days") return json([]);
        if (tbl === "marks") return json([{ date: "2026-09-16", item_id: "260916-01", state: "watched" }]);
        if (tbl === "extras") return json([{ date: "2026-09-16", url: "https://www.reddit.com/r/classicwow/comments/zz/mod/", title: "mod pick", removed: false }]);
        if (tbl === "app_state") return json([{ value: { seenNews: { "World of Warcraft": ["24304071"] }, seriesListed: { "Hardcore Moments": ["hcm384"] } } }]);
      }
      calls.writes.push({ method: opts.method, tbl, query: u.search, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
      return new Response(null, { status: 201 });
    }
    if (u.hostname === "discord.com") { calls.discord.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
    throw new Error("unrouted " + url);
  };
  return { route, calls };
}

async function runWith(envOverrides, worldOpts) {
  const { route, calls } = fakeWorld(worldOpts);
  setFetch(route);
  const saved = { ...process.env };
  Object.assign(process.env, {
    YOUTUBE_API_KEY: "yt", REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "sec", ANTHROPIC_API_KEY: "ak",
    SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test",
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x", SITE_URL: "https://example.github.io/q/",
    GITHUB_STEP_SUMMARY: "",
  }, envOverrides);
  const { run } = await import("../index.js");
  try {
    const res = await run({ now: NOW, dry: false });
    return { ...res, calls };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("end to end: collects, filters, ranks with Claude, saves", async () => {
  const { day, problems, calls, summary } = await runWith({});
  const urls = day.items.map((i) => i.url);
  // Series: #386 new; #385 already reacted to; #384 already listed
  const series = day.items.filter((i) => i.series);
  assert.deepEqual(series.map((s) => s.series), ["Hardcore Moments #386"]);
  // Official upload kept, marked official, Reddit thread merged into it
  const beta = day.items.find((i) => i.url.includes("wowbeta0001"));
  assert.ok(beta?.official, "official video present");
  assert.ok(beta.alsoOn?.some((a) => a.startsWith("r/classicwow")));
  assert.equal(beta.discussion, "https://www.reddit.com/r/classicwow/comments/a2/y/");
  // Short detected and URL rewritten
  assert.ok(urls.includes("https://www.youtube.com/shorts/short000001"));
  // Low-view search result, stale news, already-listed news, low-score/stickied reddit, off-topic PC Gamer dropped
  for (const bad of ["lowviews001", "news=0/old", "news=5/listed", "/a3/", "/a4/", "pcgamer.com/deal"]) {
    assert.ok(!urls.some((u) => u.includes(bad)), `should drop ${bad}`);
  }
  // Official page: only the unseen article
  assert.ok(urls.includes("https://worldofwarcraft.blizzard.com/en-us/news/24309999/wow-forever-beta-now-live"));
  assert.ok(!urls.some((u) => u.includes("24304071")));
  // Claude got notes, watched topics, and mod picks
  const prompt = calls.claudeBodies[0].messages[0].content;
  assert.match(prompt, /more hardcore please/);
  assert.match(prompt, /Skyborne drama/);
  assert.match(prompt, /mod pick/);
  assert.equal(calls.claudeBodies[0].model, "claude-sonnet-5");
  // Items look right
  for (const it of day.items) {
    assert.match(it.id, /^260917-\d\d$/);
    assert.ok(["epic", "rare", "uncommon"].includes(it.tier));
    assert.ok(it.why);
  }
  assert.equal(new Set(day.items.map((i) => i.id)).size, day.items.length);
  assert.equal(day.headline, "Forever beta is live.");
  // Writes: day, state (series tracker updated), sources, prune
  const dayWrite = calls.writes.find((w) => w.tbl === "days" && w.method === "POST");
  assert.equal(dayWrite.body[0].date, "2026-09-17");
  assert.equal(dayWrite.headers.apikey, "sb_secret_test");
  assert.equal(dayWrite.headers.Authorization, undefined);
  const stateWrite = calls.writes.find((w) => w.tbl === "app_state");
  assert.deepEqual(stateWrite.body[0].value.seriesListed["Hardcore Moments"].slice(0, 2), ["hcm386", "hcm384"]);
  assert.ok(stateWrite.body[0].value.seenNews["World of Warcraft"].includes("24309999"));
  assert.ok(calls.writes.some((w) => w.method === "DELETE" && w.tbl === "marks" && w.query.includes("lt.2026-07-19")));
  // Massively OP outage is reported, not fatal
  assert.ok(problems.some((p) => p.includes("Massively OP")));
  // Summary posted to Discord without pinging anyone
  assert.equal(calls.discord.length, 1);
  assert.deepEqual(calls.discord[0].allowed_mentions, { parse: [] });
  assert.match(summary, /New series: Hardcore Moments #386/);
  // Quota: no more than a few hundred units in this scenario (5 searches = 500)
  assert.ok(calls.yt.filter((x) => x === "search").length <= 5);
});

test("end to end: Claude outage falls back to rules", async () => {
  const { day, problems } = await runWith({}, { claudeFails: true });
  assert.ok(day.items.length > 3);
  assert.match(day.coverage, /rules/);
  assert.ok(problems.some((p) => p.startsWith("Claude ranking")));
  assert.ok(day.items.some((i) => i.series === "Hardcore Moments #386"));
});

test("end to end: works with only feeds (no API keys)", async () => {
  const { day, problems } = await runWith({ YOUTUBE_API_KEY: "", REDDIT_CLIENT_ID: "", ANTHROPIC_API_KEY: "" });
  assert.ok(day.items.length >= 2);
  assert.ok(problems.some((p) => p.startsWith("YouTube")));
});
