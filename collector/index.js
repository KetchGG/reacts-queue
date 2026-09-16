#!/usr/bin/env node
// Daily collector for the Xaryu React Queue.
//   node collector/index.js              collect, rank, save to Firestore, post summary
//   node collector/index.js --dry-run    collect and rank, but only write out/preview.json
//   node collector/index.js --no-claude  use the rules ranker even if ANTHROPIC_API_KEY is set
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  log, warn, http, ymdIn, monDayIn, addDays, norm, canonicalUrl, youtubeId, hostOf, fmtDuration,
} from "./lib/util.js";
import { createYouTube, isShort } from "./lib/youtube.js";
import { createReddit } from "./lib/reddit.js";
import { fetchFeed, fetchBlizzardNews } from "./lib/feeds.js";
import { createStore } from "./lib/store.js";
import { guessCat, isBluePost, ruleScore, statLine, rulesRank, claudeRank, sanitizeList } from "./lib/rank.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const env = process.env;

export async function run({ now = new Date(), dry = DRY, noClaude = args.has("--no-claude"), configPath } = {}) {
  const cfg = JSON.parse(await readFile(configPath || path.join(ROOT, "config/sources.json"), "utf8"));
  const tz = cfg.timezone || "America/New_York";
  const today = ymdIn(now, tz);
  const since = new Date(now.getTime() - (cfg.lookbackHours || 36) * 3600e3);
  const problems = [];
  const note = (where, err) => { problems.push(`${where}: ${err.message || err}`); warn(where, err.message || err); };

  // ------------------------------------------------------------------ context from the database
  const store = env.FIRESTORE_SERVICE_ACCOUNT ? createStore({ serviceAccountJson: env.FIRESTORE_SERVICE_ACCOUNT }) : null;
  if (!store && !dry) throw new Error("FIRESTORE_SERVICE_ACCOUNT is required (or use --dry-run)");

  const weekAgo = addDays(today, -7);
  const [notesVal, recentDays, marks, extras, stateVal, existingToday] = store
    ? await Promise.all([
        store.setting("notes"), store.recentDays(8), store.marksSince(weekAgo), store.extrasSince(weekAgo),
        store.state("collector", {}), store.day(today),
      ])
    : [null, [], [], [], {}, null];
  const state = { channels: {}, avatars: {}, seenNews: {}, ...stateVal };
  const notes = notesVal?.text || "";

  const listedBefore = new Set();
  const watched = [];
  // Series episodes keep resurfacing across re-runs (useful while iterating on the collector,
  // where the same run happens many times in a day with nothing new to show) until a mod
  // explicitly marks one watched or skip — derived fresh from marks each run, not a persistent
  // "shown once, never again" list, so it never goes stale.
  const seriesWatched = new Set();
  const markByKey = new Map(marks.map((m) => [`${m.date}|${m.item_id}`, m.state]));
  for (const d of recentDays) {
    for (const it of d.items || []) {
      if (d.date !== today) listedBefore.add(canonicalUrl(it.url));
      const markState = markByKey.get(`${d.date}|${it.id}`);
      if (markState === "watched") watched.push(it.title);
      if (it.series && (markState === "watched" || markState === "skip")) {
        const vid = youtubeId(it.url);
        if (vid) seriesWatched.add(vid);
      }
    }
  }
  const modPicks = [];
  for (const x of extras) {
    if (x.removed) continue;
    listedBefore.add(canonicalUrl(x.url));
    modPicks.push(x.title ? `${x.title} (${x.url})` : x.url);
  }
  const todayHasMarks = marks.some((m) => m.date === today && m.state);

  // ------------------------------------------------------------------ collect
  const cands = new Map(); // key → candidate
  const add = (c) => {
    c.key = canonicalUrl(c.url);
    if (listedBefore.has(c.key)) return;
    const prev = cands.get(c.key);
    if (prev) { prev.alsoOn = [...new Set([...(prev.alsoOn || []), ...(c.alsoOn || [])])]; return; }
    cands.set(c.key, c);
  };
  const ageHours = (iso) => (iso ? Math.max(0, (now - Date.parse(iso)) / 3600e3) : null);
  const reactedTitles = new Set();

  // YouTube
  let ytUnits = 0;
  if (env.YOUTUBE_API_KEY) {
    const yt = createYouTube(env.YOUTUBE_API_KEY, { budget: cfg.youtubeUnitBudget || 3000 });
    try {
      const refs = [...new Set([...cfg.series.map((s) => s.handle), ...cfg.officialChannels, ...cfg.creatorChannels, ...(cfg.reactedChannels || [])])];
      const ch = await yt.resolveChannels(refs, state.channels);
      const officialIds = new Set(cfg.officialChannels.map((r) => ch[r]?.id).filter(Boolean));
      const ownIds = new Set((cfg.reactedChannels || []).map((r) => ch[r]?.id).filter(Boolean));
      const vids = new Map(); // videoId → { origin, series }

      // What Xaryu already reacted to
      for (const r of cfg.reactedChannels || []) {
        if (!ch[r]) continue;
        try {
          for (const u of await yt.recentUploads(ch[r].uploads, 50)) {
            const m = u.title.match(/reacts?\s+to\s+(.+)$/i);
            if (m) reactedTitles.add(norm(m[1]));
          }
        } catch (e) { note(`YouTube ${r}`, e); }
      }

      // Series: every new episode, even if older than the lookback (up to 7 days)
      const seriesCut = now - 7 * 864e5;
      for (const s of cfg.series) {
        const c = ch[s.handle];
        if (!c) { note(`Series ${s.name}`, new Error(`channel ${s.handle} not found`)); continue; }
        try {
          const ups = await yt.recentUploads(c.uploads, 10);
          const fresh = ups.filter((u) => Date.parse(u.publishedAt) >= seriesCut && !seriesWatched.has(u.videoId)
            && (!s.titleMatch || u.title.toLowerCase().includes(s.titleMatch.toLowerCase()))).slice(0, 5);
          for (const u of fresh) vids.set(u.videoId, { origin: "series", series: s.name });
        } catch (e) { note(`Series ${s.name}`, e); }
      }

      // Official + creator uploads within the lookback. Official channels get a longer lookback
      // and a bigger uploads window: big-event coverage (BlizzCon, expansion launches) is still
      // worth surfacing days after it posts, even once creator/search results have moved past it.
      const officialSince = now.getTime() - (cfg.officialLookbackHours || 96) * 3600e3;
      for (const [list, origin, cutoff, max] of [
        [cfg.officialChannels, "youtube-official", officialSince, 15],
        [cfg.creatorChannels, "youtube-creator", since.getTime(), 8],
      ]) {
        for (const r of list) {
          if (!ch[r]) continue;
          try {
            for (const u of await yt.recentUploads(ch[r].uploads, max)) {
              if (Date.parse(u.publishedAt) >= cutoff && !vids.has(u.videoId)) vids.set(u.videoId, { origin });
            }
          } catch (e) { note(`YouTube ${r}`, e); }
        }
      }

      // Topic searches (100 units each)
      for (const q of cfg.youtubeSearches || []) {
        try {
          for (const id of await yt.search(q.q, { publishedAfter: since.toISOString(), maxResults: q.maxResults, videoDuration: q.videoDuration })) {
            if (!vids.has(id)) vids.set(id, { origin: "youtube-search" });
          }
        } catch (e) { note(`YouTube search "${q.q}"`, e); if (e.budget) break; }
      }

      if ((cfg.reactedChannels || []).length && !ownIds.size) {
        note("Xaryu self-exclusion", new Error("could not resolve his own channel this run — his own uploads may not be filtered out"));
      }
      const details = await yt.videoDetails([...vids.keys()]);
      await yt.channelAvatars(Object.values(details).map((d) => d.channelId), state.avatars);
      let ownExcluded = 0, offTopicExcluded = 0;
      for (const [id, meta] of vids) {
        const v = details[id];
        if (!v || v.live === "upcoming") continue;
        if (v.lang && !/^en/i.test(v.lang)) continue;
        if (ownIds.has(v.channelId)) { ownExcluded++; continue; } // never suggest Xaryu react to his own upload
        const official = officialIds.has(v.channelId);
        if (meta.origin === "youtube-search" && !official && v.views < (cfg.youtubeSearchMinViews || 0)) continue;
        const cat = guessCat(`${v.title} ${v.description}`, official ? "blizzard" : "");
        // A tracked creator's full upload history includes plenty of content with nothing to do
        // with WoW or gaming news (personal drama, unrelated variety) — unlike youtubeSearches
        // results, which are already topically scoped by their query text. Only gate the raw
        // creator-channel firehose, and only its "variety" bucket: require a gaming-relevance
        // signal there, same discipline the PC Gamer feed already applies via its keyword list.
        if (meta.origin === "youtube-creator" && cat === "variety") {
          const text = `${v.title} ${v.description}`.toLowerCase();
          const keywords = cfg.varietyKeywords || [];
          if (keywords.length && !keywords.some((k) => text.includes(k.toLowerCase()))) { offTopicExcluded++; continue; }
        }
        const series = meta.series ? seriesLabel(meta.series, v.title) : "";
        const hours = ageHours(v.publishedAt);
        add({
          origin: official ? "youtube-official" : meta.origin === "series" ? "youtube-creator" : meta.origin,
          url: isShort(v) ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
          videoId: id,
          seriesName: meta.series || "",
          series,
          title: v.title,
          source: v.channelTitle,
          official,
          kind: isShort(v) ? "short" : "video",
          cat,
          publishedAt: v.publishedAt,
          durationSec: v.durationSec,
          thumb: v.thumb,
          avatar: state.avatars[v.channelId]?.avatar || "",
          excerpt: v.description,
          metrics: { views: v.views, comments: v.comments, ageHours: hours, viewsPerHour: hours ? v.views / Math.max(hours, 1) : v.views },
        });
      }
      if (ownExcluded) log(`Excluded ${ownExcluded} of Xaryu's own uploads`);
      if (offTopicExcluded) log(`Excluded ${offTopicExcluded} off-topic "variety" videos with no gaming-relevance keyword match`);
    } catch (e) { note("YouTube", e); }
    ytUnits = yt.unitsUsed;
    log(`YouTube: ${ytUnits} quota units used`);
  } else {
    problems.push("YouTube: YOUTUBE_API_KEY not set, skipped");
  }

  // Reddit
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    const rd = createReddit({ clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET, userAgent: env.REDDIT_USER_AGENT });
    for (const s of cfg.subreddits || []) {
      try {
        for (const p of await rd.top(s.name, { limit: s.limit || 15 })) {
          if (p.score < (s.minScore || 0) || Date.parse(p.createdAt) < since) continue;
          const vid = youtubeId(p.linkUrl);
          const tag = `r/${p.sub} (${p.score} upvotes)`;
          const existing = vid && cands.get(`yt:${vid}`);
          if (existing) {
            existing.alsoOn = [...(existing.alsoOn || []), tag];
            existing.metrics.score = Math.max(existing.metrics.score || 0, p.score);
            existing.discussion = p.permalink;
            continue;
          }
          add({
            origin: "reddit",
            url: p.permalink,
            linkUrl: p.linkUrl,
            sub: p.sub,
            title: p.title,
            source: `r/${p.sub}`,
            kind: vid ? "video" : p.isVideo || /clips\.twitch|streamable|v\.redd/.test(p.domain) ? "video" : "post",
            cat: s.cat || guessCat(`${p.sub} ${p.title} ${p.flair}`, p.sub === "MMORPG" ? "mmo" : ""),
            publishedAt: p.createdAt,
            thumb: vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : p.thumb,
            excerpt: [p.flair && `[${p.flair}]`, p.selftext, p.linkUrl && `link: ${p.domain}`].filter(Boolean).join(" "),
            metrics: { score: p.score, comments: p.comments, ageHours: ageHours(p.createdAt) },
          });
        }
      } catch (e) { note(`Reddit r/${s.name}`, e); }
    }
  } else {
    problems.push("Reddit: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set, skipped");
  }

  // News feeds
  for (const f of cfg.feeds || []) {
    try {
      for (const it of await fetchFeed(f.url)) {
        if (!it.publishedAt || Date.parse(it.publishedAt) < since) continue;
        const text = `${it.title} ${it.summary}`;
        if (f.keywords && !f.keywords.some((k) => text.toLowerCase().includes(k))) continue;
        add({
          origin: "news", priority: f.priority || 0, url: it.link, title: it.title, source: f.name, kind: "article",
          cat: f.cat || guessCat(text), bluePost: isBluePost(text), publishedAt: it.publishedAt, thumb: it.image, excerpt: it.summary,
          metrics: { ageHours: ageHours(it.publishedAt) },
        });
      }
    } catch (e) { note(`Feed ${f.name}`, e); }
  }

  // Official pages without feeds: treat unseen article ids as new
  for (const p of cfg.officialPages || []) {
    try {
      const items = await fetchBlizzardNews(p.url, p.base);
      if (!items.length) throw new Error("no articles found on the page (layout may have changed)");
      const seen = new Set(state.seenNews[p.name] || []);
      const firstRun = seen.size === 0;
      const fresh = items.filter((i) => !seen.has(i.id)).slice(0, firstRun ? 3 : 8);
      for (const it of fresh) {
        add({
          origin: "news", priority: 3, official: true, url: it.link, title: it.title, source: p.name, kind: "article",
          cat: guessCat(it.title, "blizzard"), publishedAt: "", thumb: it.image, excerpt: "", metrics: { ageHours: null },
        });
      }
      state.seenNews[p.name] = [...new Set([...items.map((i) => i.id), ...seen])].slice(0, 300);
    } catch (e) { note(`Official page ${p.name}`, e); }
  }

  // ------------------------------------------------------------------ filter + rank
  let pool = [...cands.values()].filter((c) => {
    const t = norm(c.title);
    return ![...reactedTitles].some((r) => r && (t === r || (r.length > 12 && ` ${t} `.includes(` ${r} `))));
  });
  pool.forEach((c) => { c.score = ruleScore(c); });
  pool.sort((a, b) => b.score - a.score);
  pool = [...pool.filter((c) => c.series), ...pool.filter((c) => !c.series).slice(0, 120)];
  pool.forEach((c, i) => { c.ref = `c${i + 1}`; });
  log(`Candidates: ${cands.size} collected, ${pool.length} sent to ranking`);
  if (!pool.length && !existingToday) throw new Error(`Nothing collected. Problems: ${problems.join("; ") || "none"}`);

  const min = cfg.listSize?.min || 14, max = cfg.listSize?.max || 24;
  let list;
  if (env.ANTHROPIC_API_KEY && !noClaude && pool.length) {
    try {
      list = await claudeRank(pool, {
        hints: cfg.rankingHints || [], notes, watched, modPicks,
        dateLabel: new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full" }).format(now),
      }, { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || "claude-sonnet-5", min, max });
      log(`Ranked by ${list.ranker}`, list.usage ? `(${list.usage.input_tokens} in / ${list.usage.output_tokens} out tokens)` : "");
    } catch (e) {
      note("Claude ranking (fell back to rules)", e);
    }
  }
  if (!list) list = rulesRank(pool, { max });
  const ranker = list.ranker;
  const clean = sanitizeList(list, pool, { max });

  // ------------------------------------------------------------------ build the day
  const refMap = new Map(pool.map((c) => [c.ref, c]));
  const prefix = today.slice(2).replace(/-/g, "");
  // Never wipe a list mods are using, and never replace a list with an empty one.
  const keepExisting = !!existingToday && (todayHasMarks || !pool.length);
  const existingItems = keepExisting ? existingToday.items || [] : [];
  const existingKeys = new Set(existingItems.map((i) => canonicalUrl(i.url)));
  let seq = existingItems.reduce((n, i) => Math.max(n, Number(String(i.id).split("-")[1]) || 0), 0);

  const newItems = [];
  for (const p of clean.items) {
    const c = refMap.get(p.ref);
    if (existingKeys.has(c.key)) continue;
    seq += 1;
    newItems.push(stripEmpty({
      id: `${prefix}-${String(seq).padStart(2, "0")}`,
      tier: p.tier,
      series: c.series || undefined,
      official: c.official || undefined,
      bluePost: c.bluePost || undefined,
      cat: p.cat,
      kind: c.kind === "post" ? "post" : c.kind,
      title: c.title,
      source: c.source,
      url: c.url,
      discussion: c.discussion || (c.origin === "reddit" && c.linkUrl ? c.url : undefined),
      link: c.origin === "reddit" && c.linkUrl ? c.linkUrl : undefined,
      posted: c.publishedAt ? monDayIn(new Date(c.publishedAt), tz) : "New",
      publishedAt: c.publishedAt || undefined,
      length: c.durationSec && c.kind !== "short" ? fmtDuration(c.durationSec) : undefined,
      stats: statLine(c) || undefined,
      alsoOn: c.alsoOn?.length ? c.alsoOn : undefined,
      why: p.why,
      thumb: c.thumb || undefined,
      avatar: c.avatar || undefined,
      domain: hostOf(c.origin === "reddit" && c.linkUrl ? c.linkUrl : c.url),
      origin: c.origin,
    }));
  }

  const seriesNew = newItems.filter((i) => i.series);
  const day = {
    date: today,
    headline: keepExisting ? existingToday.headline : clean.headline || "",
    coverage: `Last ${cfg.lookbackHours || 36}h · ranked by ${ranker.startsWith("claude") ? "Claude" : "rules"}`,
    generated_at: now.toISOString(),
    items: [...existingItems, ...newItems],
  };

  // ------------------------------------------------------------------ save
  if (!dry) {
    await store.putDay(day);
    await store.putState("collector", state);
    await store.putSetting("sources", sourcesSummary(cfg, env));
    await store.pruneBefore(addDays(today, -60));
    log(`Saved ${day.items.length} items for ${today}${keepExisting ? " (added to the existing list)" : ""}`);
  } else {
    await mkdir(path.join(ROOT, "out"), { recursive: true });
    await writeFile(path.join(ROOT, "out/preview.json"), JSON.stringify({ day, problems, ytUnits }, null, 2));
    log("Dry run: wrote out/preview.json");
  }

  // ------------------------------------------------------------------ summary
  const summary = buildSummary({ day, newItems, seriesNew, problems, ytUnits, ranker, now, tz, siteUrl: env.SITE_URL, keepExisting, cfg });
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (env.DISCORD_WEBHOOK_URL && !dry) {
    try {
      await http(env.DISCORD_WEBHOOK_URL, {
        method: "POST", as: "text", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: summary.slice(0, 1990), allowed_mentions: { parse: [] }, flags: 4 }),
      });
    } catch (e) { warn("Discord post failed:", e.message); }
  }
  console.log("\n" + summary);
  return { day, problems, summary };
}

function seriesLabel(name, title) {
  const n = String(title).match(/#\s?(\d+)/);
  return n ? `${name} #${n[1]}` : name;
}

function stripEmpty(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));
}

function sourcesSummary(cfg, env) {
  return {
    groups: [
      { label: "Always include (series)", entries: cfg.series.map((s) => `${s.name} (${s.handle})`) },
      { label: "Official — top priority", entries: [...cfg.officialChannels, ...(cfg.officialPages || []).map((p) => p.name + " news")] },
      { label: "News feeds", entries: [...new Set((cfg.feeds || []).map((f) => f.name))] },
      { label: "YouTube creators", entries: cfg.creatorChannels },
      { label: "YouTube searches", entries: (cfg.youtubeSearches || []).map((q) => q.q) },
      { label: "Reddit", entries: env.REDDIT_CLIENT_ID ? (cfg.subreddits || []).map((s) => `r/${s.name}`) : ["Not connected yet"] },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function buildSummary({ day, newItems, seriesNew, problems, ytUnits, ranker, now, tz, siteUrl, keepExisting }) {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(now);
  const lines = [`**React picks for ${label}**: ${day.items.length} items on the board${keepExisting ? ` (${newItems.length} added)` : ""}.`];
  lines.push(seriesNew.length ? `New series: ${seriesNew.map((s) => s.series).join(", ")}` : "No new Hardcore Moments / Forever Moments today.");
  const epics = newItems.filter((i) => i.tier === "epic" && !i.series).slice(0, 6);
  if (epics.length) {
    lines.push("Top picks:");
    for (const e of epics) lines.push(`• [${e.title.replace(/[[\]]/g, "")}](<${e.url}>) – ${e.source}${e.official ? " (official)" : ""}`);
  }
  if (day.headline && !keepExisting) lines.push("", day.headline);
  const meta = [`ranked by ${ranker.startsWith("claude") ? "Claude" : "rules"}`, ytUnits ? `${ytUnits} YouTube units` : ""].filter(Boolean).join(" · ");
  lines.push("", `_${meta}${problems.length ? ` · ${problems.length} source problem(s): ${problems.slice(0, 3).join("; ")}` : ""}_`);
  if (siteUrl) lines.push(siteUrl);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
