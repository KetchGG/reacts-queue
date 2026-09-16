# Xaryu React Queue — notes for Claude Code

A daily react-content list for the Twitch streamer Xaryu (WoW Classic, Classic Hardcore, WoW: Forever, plus variety streams). His mod Andrew owns this project. It has three parts — no custom backend server at all:

1. **Collector** (`collector/`, Node 20+, zero runtime dependencies), run daily by GitHub Actions (`.github/workflows/daily.yml`, 13:05 UTC):
   - Collects from the YouTube Data API v3, Reddit (optional), RSS feeds and Blizzard's WoW news page.
   - Filters out anything listed in the last 7 days, links mods added by hand, and topics Xaryu already posted "Xaryu Reacts to …" videos about.
   - Ranks with Claude (Anthropic Messages API, forced tool call `publish_list`), falling back to `rulesRank` if Claude fails.
   - Saves the day to Firestore via `collector/lib/firestore.js` (a hand-rolled REST client authenticated as a service account — no `firebase-admin` dependency, so the whole `setFetch()`-based offline test suite still works) and posts an optional Discord summary.
2. **Database** (Firestore, rules in `firestore/firestore.rules`): collections `days`, `marks`, `extras`, `settings`, plus a private `app_state`.
   - Public rules allow reads on `days`/`marks`/`extras`/`settings` (only the `notes`/`sources` docs within `settings`) with no key needed — no rule at all on `app_state`, so the browser can't reach it regardless.
   - Mod writes require `request.auth != null` — mods sign into one shared Firebase Authentication (Email/Password) account using the mod password, and the website then writes to Firestore directly with the resulting ID token. **No custom backend, no password ever stored in Firestore** — Firebase Auth handles password storage and guess-throttling for us.
   - The collector writes `days`/`app_state`/`settings.sources` using its own service-account credentials — that's IAM auth, not covered by `firestore.rules` at all, so it works regardless of what mods can or can't do.
   - Nested/blob fields (`days.items`, `settings.value`, `app_state.value`) are stored as JSON-stringified strings, not native Firestore maps/arrays — nothing ever queries inside them, so there was no reason to hand-write a full typed-value converter.
3. **Website** (`docs/`, GitHub Pages, one static `index.html` plus `config.js`): reads and writes go straight to Firestore's public REST API from the browser — reads are rules-gated with no key needed, writes require the Firebase Auth ID token from mod sign-in. Polls every 30s. No API, no server, nothing to deploy beyond static files.

**Why no server:** we initially built a small Express API on Cloud Run for the mod-password check, but Cloud Run (like all Google Cloud compute) requires the project to be on Firebase's paid "Blaze" plan even though usage stays within its free tier — Andrew didn't want to link a card for a POC. Moving the password check into Firebase Authentication instead avoids that entirely while staying on the free "Spark" plan, and arguably improves security (Firebase Auth throttles guesses; our own bcrypt+`sleep()` approach didn't).

What to check, and how the ranking is steered, lives in `config/sources.json`.

## Commands
- `npm test` runs the offline tests (fake APIs, including a fake OAuth token exchange and Firestore REST). Run them after every code change; the daily workflow runs them too and stops if they fail.
- `npm run dry-run` collects and ranks without writing to the database and writes `out/preview.json`. It uses whatever API keys are in the environment.
- `node --check <file>` is a quick syntax check.

## Rules
- **Never ask the user to paste API keys, the Firestore service-account JSON, or the mod password into the chat, and never echo them.** Secrets go into GitHub with `scripts/set-secrets.sh`, which Andrew runs himself in a separate terminal (it prompts with hidden input, and reads the service-account key from a file path rather than an inline value). The mod password is set entirely in the Firebase Console (Authentication → Users) by Andrew — there's no script or API call that touches it.
- `docs/config.js`'s `firestoreProjectId`, `firebaseApiKey`, and `modEmail` are public by design — the Web API key only identifies the project, it isn't a secret (Firebase's own docs say so; access control lives in `firestore.rules`, not the key). A **service-account JSON key** (anything with `private_key`/`client_email`) must never go in `docs/config.js` or anywhere under `docs/` — `scripts/check-setup.sh` greps for this.
- Don't add npm dependencies to `collector/` unless there's a strong reason; keeping it dependency-free keeps the Action fast, simple, and mockable via `setFetch()` in tests. The repo has zero dependencies anywhere — keep it that way unless there's a real need.
- When creating the Firestore database for the first time, choose **Production mode**, not Test mode — Test mode defaults to `allow read, write: if true` for 30 days, which would leave `app_state` open and let anyone write anything. Publish `firestore/firestore.rules` immediately after.
- YouTube quota is 10,000 units a day. `search.list` costs 100, everything else costs 1. Prefer uploads playlists over search, and keep `youtubeUnitBudget` in mind.
- Reddit has required manual approval for new API apps since Nov 2025. Don't work around that (no scraping, no `.json` endpoints, no mirrors). Mods cover Reddit through the site's "Add a link" box.
- The site must escape everything it renders (`esc`) and only link http(s) URLs (`safeUrl`). Data in the database can come from mods.
- Series episodes ("Hardcore Moments" from @ClassicHardcoreMoments, "Forever Moments" from @WoWForeverMomentsYT) must always appear when new. Only accept them when the channel matches, because other channels copy these titles.
- Official Blizzard channels and pages get `official: true` and rank above community re-coverage. Wowhead is the preferred news outlet.

## Setup status
`SETUP.md` is the full manual walkthrough. `scripts/check-setup.sh` reports what's done. First-time setup order:
1. Create the GitHub repo and push.
2. Create the Firebase project, enable Firestore (Production mode), publish `firestore/firestore.rules`.
3. Enable Authentication → Email/Password, add one shared mod user with the mod password.
4. Download a service-account key (for the collector only) and get the Web API key (for the website).
5. Get the YouTube key and the Anthropic key.
6. Run `scripts/set-secrets.sh`.
7. Fill in `docs/config.js` (`firestoreProjectId`, `firebaseApiKey`, `modEmail`).
8. Turn on Pages (main /docs).
9. Run the workflow (`gh workflow run daily.yml`) and check the site.

Andrew also has a temporary Claude (cowork) scheduled task feeding an older claude.ai board. It should be switched off once this site is live; he'll do that from the Claude app.
