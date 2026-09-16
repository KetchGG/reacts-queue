# Xaryu React Queue — notes for Claude Code

A daily react-content list for the Twitch streamer Xaryu (WoW Classic, Classic Hardcore, WoW: Forever, plus variety streams). His mod Andrew owns this project. It has three parts:

1. **Collector** (`collector/`, Node 20+, zero dependencies), run daily by GitHub Actions (`.github/workflows/daily.yml`, 13:05 UTC):
   - Collects from the YouTube Data API v3, Reddit (optional), RSS feeds and Blizzard's WoW news page.
   - Filters out anything listed in the last 7 days, links mods added by hand, and topics Xaryu already posted "Xaryu Reacts to …" videos about.
   - Ranks with Claude (Anthropic Messages API, forced tool call `publish_list`), falling back to `rulesRank` if Claude fails.
   - Upserts the day into Supabase and posts an optional Discord summary.
2. **Database** (`supabase/schema.sql`): tables `days`, `marks`, `extras`, `settings`, plus private `app_state` and `mod_secret`.
   - The public (publishable key) role can only SELECT.
   - Every mod write goes through a SECURITY DEFINER RPC (`set_mark`, `add_extra`, `remove_extra`, `set_notes`, `verify_mod`) that checks a shared bcrypt-hashed mod password.
   - The collector uses the secret key.
3. **Website** (`docs/`, GitHub Pages, one static `index.html` plus `config.js`): reads Supabase over REST and polls every 30s. Mods sign in with the shared password to mark picks, add links and edit notes.

What to check, and how the ranking is steered, lives in `config/sources.json`.

## Commands
- `npm test` runs the offline tests (fake APIs). Run them after every code change; the daily workflow runs them too and stops if they fail.
- `npm run dry-run` collects and ranks without writing to the database and writes `out/preview.json`. It uses whatever API keys are in the environment.
- `node --check <file>` is a quick syntax check.

## Rules
- **Never ask the user to paste API keys, the Supabase secret key, or the mod password into the chat, and never echo them.** Secrets go into GitHub with `scripts/set-secrets.sh`, which Andrew runs himself in a separate terminal (it prompts with hidden input). The mod password is set by Andrew in the Supabase SQL editor.
- The Supabase **publishable** key and project URL are public by design and belong in `docs/config.js`. The **secret** key never goes in the repo.
- Don't add npm dependencies to the collector unless there's a strong reason; keeping it dependency-free keeps the Action fast and simple.
- Keep `supabase/schema.sql` safe to re-run (`if not exists`, `create or replace`, `drop policy if exists`). New tables need explicit GRANTs: Supabase no longer exposes new tables automatically.
- Supabase new-style keys (`sb_publishable_…`, `sb_secret_…`) go in the `apikey` header only. Legacy JWT keys (`eyJ…`) also need `Authorization: Bearer`. `store.js` and the site already handle both.
- YouTube quota is 10,000 units a day. `search.list` costs 100, everything else costs 1. Prefer uploads playlists over search, and keep `youtubeUnitBudget` in mind.
- Reddit has required manual approval for new API apps since Nov 2025. Don't work around that (no scraping, no `.json` endpoints, no mirrors). Mods cover Reddit through the site's "Add a link" box.
- The site must escape everything it renders (`esc`) and only link http(s) URLs (`safeUrl`). Data in the database can come from mods.
- Series episodes ("Hardcore Moments" from @ClassicHardcoreMoments, "Forever Moments" from @WoWForeverMomentsYT) must always appear when new. Only accept them when the channel matches, because other channels copy these titles.
- Official Blizzard channels and pages get `official: true` and rank above community re-coverage. Wowhead is the preferred news outlet.

## Setup status
`SETUP.md` is the full manual walkthrough. `scripts/check-setup.sh` reports what's done. First-time setup order:
1. Create the GitHub repo and push.
2. Create the Supabase project, run the schema, set the mod password.
3. Get the YouTube key and the Anthropic key.
4. Run `scripts/set-secrets.sh`.
5. Fill in `docs/config.js`.
6. Turn on Pages (main /docs).
7. Run the workflow (`gh workflow run daily.yml`) and check the site.

Andrew also has a temporary Claude (cowork) scheduled task feeding an older claude.ai board. It should be switched off once this site is live; he'll do that from the Claude app.
