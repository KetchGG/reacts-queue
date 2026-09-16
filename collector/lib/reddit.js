// Reddit Data API (app-only OAuth). Free for non-commercial use such as moderator tools, 100 requests/minute.
// Create a "script" app at https://www.reddit.com/prefs/apps to get the client id and secret.
import { http, decodeEntities } from "./util.js";

export function createReddit({ clientId, clientSecret, userAgent }) {
  let token = null;
  const ua = userAgent || "xaryu-react-queue/1.0 (moderator tool)";

  async function auth() {
    if (token) return token;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const r = await http("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua },
      body: "grant_type=client_credentials",
    });
    if (!r?.access_token) throw new Error("Reddit did not return an access token (check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET)");
    token = r.access_token;
    return token;
  }

  return {
    /** Top posts of the day for a subreddit. */
    async top(sub, { t = "day", limit = 15 } = {}) {
      const tk = await auth();
      const r = await http(`https://oauth.reddit.com/r/${encodeURIComponent(sub)}/top?t=${t}&limit=${limit}&raw_json=1`, {
        headers: { Authorization: `Bearer ${tk}`, "User-Agent": ua },
      });
      return (r?.data?.children || [])
        .map((c) => c.data)
        .filter((p) => p && !p.stickied && !p.over_18 && !p.removed_by_category)
        .map((p) => ({
          id: p.id,
          sub: p.subreddit,
          title: decodeEntities(p.title),
          permalink: `https://www.reddit.com${p.permalink}`,
          linkUrl: p.is_self ? "" : p.url_overridden_by_dest || p.url || "",
          domain: p.domain || "",
          score: p.score || 0,
          comments: p.num_comments || 0,
          createdAt: new Date((p.created_utc || 0) * 1000).toISOString(),
          flair: p.link_flair_text || "",
          isVideo: !!p.is_video,
          selftext: (p.selftext || "").slice(0, 300),
          thumb: /^https?:/.test(p.thumbnail || "") ? p.thumbnail : "",
        }));
    },
  };
}
