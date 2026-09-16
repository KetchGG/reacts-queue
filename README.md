# Xaryu React Queue

A daily list of react content for Xaryu's stream, with a public board his mods can work from.

- **Collects** new uploads from Blizzard's official channels, tracked creators and the *Classic Hardcore Moments* / *WoW: Forever Moments* series. It also picks up trending YouTube videos and shorts (via the YouTube Data API), Wowhead / Blizzard Watch / Massively OP / PC Gamer news feeds, Blizzard's WoW news page, and optionally Reddit.
- **Filters out** anything already listed in the last week, anything mods added by hand, and anything Xaryu already posted a "Xaryu Reacts to …" video about.
- **Ranks** the list with Claude, which writes a short note on each pick and follows the mods' notes. If Claude isn't available, simple rules rank it instead.
- **Publishes** to Firestore. The website in `docs/` (GitHub Pages) shows thumbnails, channel avatars, view counts, exact upload dates, and Official / Today / Series badges.
- **Mods** sign in with a shared password (via Firebase Authentication) to queue, mark seen or skip, add links, and leave notes for tomorrow's run. Everyone else can view without an account. There's no custom backend server — the website talks straight to Firestore.

**Setup:** with Claude Code, start with [KICKOFF.md](KICKOFF.md). To do it by hand, follow [SETUP.md](SETUP.md).

```
collector/            daily job (Node 20+, no dependencies)
  index.js            collect → filter → rank → save → summary
  lib/                youtube, reddit, feeds, rank (Claude + rules), store + firestore (REST client), util
  test/                offline tests with fake APIs (npm test)
config/sources.json   what to check: channels, searches, subreddits, feeds
firestore/            security rules (public read; mod writes require Firebase Auth sign-in)
docs/                 the website (index.html + config.js) — reads and writes Firestore directly
.github/workflows/    daily schedule
```

Local dry run: `YOUTUBE_API_KEY=… ANTHROPIC_API_KEY=… npm run dry-run` writes `out/preview.json` without touching the database.

Privacy note: the website loads fonts from Google Fonts, site icons from Google's favicon service, and thumbnails from YouTube, and it talks directly to Firestore's and Firebase Authentication's public REST APIs — so viewers' browsers contact all of those services.
