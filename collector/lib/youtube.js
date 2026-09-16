// YouTube Data API v3 client with a unit budget.
// Costs: channels.list / playlistItems.list / videos.list = 1 unit, search.list = 100 units. Default daily quota: 10,000.
import { http, chunk, isoDurationToSec, warn } from "./util.js";

const API = "https://www.googleapis.com/youtube/v3";

export function createYouTube(apiKey, { budget = 3000 } = {}) {
  let units = 0;
  const call = async (path, params, cost) => {
    if (units + cost > budget) throw Object.assign(new Error(`YouTube unit budget (${budget}) reached`), { budget: true });
    units += cost;
    const qs = new URLSearchParams({ ...params, key: apiKey });
    return http(`${API}/${path}?${qs}`);
  };

  return {
    get unitsUsed() { return units; },

    /**
     * Resolve "@handle" or "UC…" ids to channel info, using and updating `cache`
     * ({ [ref]: { id, title, avatar, uploads, fetchedAt } }). Entries older than 7 days are refreshed.
     */
    async resolveChannels(refs, cache = {}) {
      const out = {};
      const stale = (e) => !e || !e.fetchedAt || Date.now() - Date.parse(e.fetchedAt) > 7 * 864e5;
      const needIds = [];
      for (const ref of refs) {
        const e = cache[ref];
        if (!stale(e)) { out[ref] = e; continue; }
        if (/^UC[\w-]{22}$/.test(ref)) { needIds.push(ref); continue; }
        try {
          const r = await call("channels", { part: "snippet,contentDetails", forHandle: ref.replace(/^@/, "") }, 1);
          const c = r.items?.[0];
          if (!c) { warn(`YouTube handle not found: ${ref} (check config/sources.json)`); if (e) out[ref] = e; continue; }
          out[ref] = cache[ref] = channelInfo(c);
        } catch (err) {
          if (err.budget) throw err;
          warn(`Could not resolve ${ref}: ${err.message}`);
          if (e) out[ref] = e;
        }
      }
      for (const ids of chunk(needIds, 50)) {
        const r = await call("channels", { part: "snippet,contentDetails", id: ids.join(","), maxResults: 50 }, 1);
        for (const c of r.items || []) out[c.id] = cache[c.id] = channelInfo(c);
      }
      return out;
    },

    /** Latest uploads of a channel via its uploads playlist (1 unit). */
    async recentUploads(uploadsPlaylistId, max = 10) {
      const r = await call("playlistItems", { part: "snippet,contentDetails", playlistId: uploadsPlaylistId, maxResults: max }, 1);
      return (r.items || []).map((it) => ({
        videoId: it.contentDetails?.videoId,
        title: it.snippet?.title || "",
        publishedAt: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt,
      })).filter((v) => v.videoId);
    },

    /** search.list (100 units). Returns video ids. */
    async search(q, { publishedAfter, maxResults = 15, videoDuration, order = "viewCount", regionCode = "US", relevanceLanguage = "en" } = {}) {
      const params = { part: "id", type: "video", q, maxResults, order, publishedAfter, regionCode, relevanceLanguage };
      if (videoDuration) params.videoDuration = videoDuration;
      const r = await call("search", params, 100);
      return (r.items || []).map((it) => it.id?.videoId).filter(Boolean);
    },

    /** Full details for up to 50 ids per unit. */
    async videoDetails(ids) {
      const out = {};
      for (const group of chunk([...new Set(ids)], 50)) {
        const r = await call("videos", { part: "snippet,contentDetails,statistics,status", id: group.join(","), maxResults: 50 }, 1);
        for (const v of r.items || []) {
          const s = v.snippet || {};
          const t = s.thumbnails || {};
          out[v.id] = {
            videoId: v.id,
            title: s.title || "",
            description: (s.description || "").slice(0, 400),
            channelId: s.channelId,
            channelTitle: s.channelTitle,
            publishedAt: s.publishedAt,
            durationSec: isoDurationToSec(v.contentDetails?.duration),
            views: Number(v.statistics?.viewCount || 0),
            likes: Number(v.statistics?.likeCount || 0),
            comments: Number(v.statistics?.commentCount || 0),
            live: s.liveBroadcastContent && s.liveBroadcastContent !== "none" ? s.liveBroadcastContent : "",
            thumb: (t.medium || t.high || t.default || {}).url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
            lang: s.defaultAudioLanguage || s.defaultLanguage || "",
            embeddable: v.status?.embeddable !== false,
          };
        }
      }
      return out;
    },

    /** Avatars for arbitrary channel ids (1 unit per 50). */
    async channelAvatars(channelIds, cache = {}) {
      const missing = [...new Set(channelIds)].filter((id) => id && !cache[id]);
      for (const group of chunk(missing, 50)) {
        const r = await call("channels", { part: "snippet,contentDetails", id: group.join(","), maxResults: 50 }, 1);
        for (const c of r.items || []) cache[c.id] = channelInfo(c);
      }
      return cache;
    },
  };
}

function channelInfo(c) {
  const t = c.snippet?.thumbnails || {};
  return {
    id: c.id,
    title: c.snippet?.title || "",
    handle: c.snippet?.customUrl || "",
    avatar: (t.default || t.medium || {}).url || "",
    uploads: c.contentDetails?.relatedPlaylists?.uploads || (c.id ? "UU" + c.id.slice(2) : ""),
    fetchedAt: new Date().toISOString(),
  };
}

/** Shorts are ≤ 3 minutes; treat ≤ 60s, or ≤ 180s with #shorts, as a short. */
export function isShort(v) {
  const d = v.durationSec || 0;
  if (!d) return false;
  return d <= 60 || (d <= 180 && /#shorts?\b/i.test(`${v.title} ${v.description || ""}`));
}
