# Setup guide

This takes about 20–30 minutes the first time. Everything here is free except the Claude API, which costs roughly **$1–3 a month**.

When you're done:

- **Every morning:** a GitHub job collects new videos and news, has Claude rank them, and saves the list.
- **The website:** anyone with the link can see the list, no account needed.
- **Mods:** anyone with the shared mod password can mark picks, add links and leave notes.

| What | Where it lives | Cost |
|---|---|---|
| Daily job + website | GitHub (Actions + Pages) | Free (the repo must be public for free Pages) |
| Database + mod sign-in | Firebase (Firestore + Authentication) | Free tier ("Spark" plan — no card needed) |
| YouTube data | Google Cloud (YouTube Data API v3) | Free (10,000 units/day; the job uses ~550) |
| Ranking + notes | Anthropic API (Claude) | About $0.05–0.10/day with Sonnet 5 |
| Daily summary (optional) | Discord webhook | Free |
| Reddit (optional) | Reddit Data API | Free if Reddit approves you; see step 6 |

There's no custom backend server and nothing to deploy beyond static files — the website talks straight to Firestore, gated by security rules and Firebase's built-in Email/Password sign-in.

---

## 1. Put the code on GitHub

1. Create a free account at <https://github.com> if you don't have one.
2. Click **New repository**. Name it `xaryu-react-queue`, set it to **Public**, and click **Create repository**.
3. Upload the files. The easiest way is **GitHub Desktop** (<https://desktop.github.com>): clone the empty repo, copy everything from this folder into it, then **Commit** and **Push**.
   - You can also drag the files onto the repo page ("uploading an existing file"). Make sure the hidden `.github` folder goes too. On a Mac, press **Cmd + Shift + .** in Finder to show hidden folders.

## 2. Create the database (Firebase / Firestore)

1. Sign in at <https://console.firebase.google.com> and click **Add project**. Pick any name; Google Analytics isn't needed.
2. Open **Build → Firestore Database → Create database**. Choose **Production mode** (not "Test mode" — test mode leaves everything open for 30 days) and any region.
3. Open **Rules**, delete what's there, paste in the whole of `firestore/firestore.rules`, and click **Publish**.

## 3. Set up mod sign-in (Firebase Authentication)

There's no separate password system here — mods sign into one shared Firebase account, and that's what proves they're a mod.

1. Open **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, enable **Email/Password**.
3. Go to the **Users** tab → **Add user**. For the email, use exactly `mods@reacts-queue.local` (this must match `modEmail` in `docs/config.js`, step 8 below — it's not a real inbox, mods never see it). For the password, pick the shared mod passphrase yourself — don't tell me what it is.
4. To change the password later: delete that user and add it again with the new password. Mods who are already signed in will be asked to sign in again.

## 4. Get the keys the app needs

1. **Service-account key** (for the daily job only): Firebase Console → gear icon → **Project settings → Service accounts → Generate new private key**. Downloads a JSON file — keep it somewhere safe, never commit it (it's gitignored already).
2. **Web API key** (public, safe to put on the website): same **Project settings** page, **General** tab → look for **Web API Key** near the bottom.
3. **Project ID**: also on the **General** tab, near the top.

## 5. Get a YouTube API key (Google Cloud)

1. Go to <https://console.cloud.google.com>, sign in, and select the **same project** you created in Firebase (Firebase projects are Google Cloud projects).
2. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
4. Click the new key and, under **API restrictions**, choose **Restrict key → YouTube Data API v3**, then **Save**.

## 6. Get a Claude API key (Anthropic)

1. Go to <https://console.anthropic.com> and sign up. This is a separate account from your Claude.ai chat subscription.
2. Under **Billing**, add a small amount of credit ($5 lasts a couple of months). You can also set a monthly spend limit there.
3. Under **API Keys**, create a key and copy it.

*If you ever skip this key, the job still runs and ranks with simple rules (no written notes).*

## 7. (Optional) Discord summary

In Discord, open the mod channel's **Edit Channel → Integrations → Webhooks → New Webhook** and copy the webhook URL. The job posts a short summary there each morning (it never pings anyone).

## 8. (Optional) Reddit

Since November 2025, Reddit requires approval before anyone can use its API, and new requests can take a long time or be turned down. If you want to try:

1. File a developer access request through Reddit's help center (see the "Responsible Builder Policy" page) and describe the project as a non-commercial moderator tool that reads the top daily posts of a few subreddits.
2. If Reddit approves you, create a **script** app at <https://www.reddit.com/prefs/apps> and copy the client ID (under the app name) and the secret.

Until then, mods can paste Reddit finds into the website's **Add a link** box. The daily job reads those picks so it doesn't repeat the same stories.

## 9. Add the secrets to GitHub

In your repo, open **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, click **New repository secret** for each of these:

| Name | Value |
|---|---|
| `FIRESTORE_SERVICE_ACCOUNT` | The whole contents of the service-account JSON file from step 4.1 |
| `YOUTUBE_API_KEY` | Key from step 5 |
| `ANTHROPIC_API_KEY` | Key from step 6 |
| `DISCORD_WEBHOOK_URL` | *(optional)* from step 7 |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | *(optional)* from step 8 |
| `REDDIT_USER_AGENT` | *(optional)* e.g. `xaryu-react-queue/1.0 (by /u/YOUR_REDDIT_NAME)` |

`scripts/set-secrets.sh` can do this from your own terminal instead — it asks for a **file path** for the service-account key (not the value itself) and pastes the others in hidden.

On the **Variables** tab, add:

| Name | Value |
|---|---|
| `SITE_URL` | Your website address from step 10 (added to the Discord summary) |
| `ANTHROPIC_MODEL` | *(optional)* defaults to `claude-sonnet-5`. Use `claude-haiku-4-5-20251001` to cut cost further |

## 10. Turn on the website

1. In the repo, open `docs/config.js` and click the pencil icon to edit it. Set `firestoreProjectId` (step 4.3) and `firebaseApiKey` (step 4.2); leave `modEmail` as-is unless you used a different email in step 3.3. Click **Commit changes**.
2. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then **main** and **/docs**, and click **Save**.
3. After a minute or two the page shows your site address, usually `https://YOUR-GITHUB-NAME.github.io/xaryu-react-queue/`.

## 11. First run

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Daily react list → Run workflow → Run workflow**.
3. After about a minute, open the run. The summary lists what it found and any source that had a problem.
4. Open your website. Today's list should be there.

From then on it runs by itself every day at about **9:05 AM Eastern** (8:05 AM in winter, because GitHub schedules in UTC).

## 12. Share it

- **Viewers:** send anyone the website link. They see the list and what's been queued or watched.
- **Mods:** also give them the mod password. They click **Mod sign-in**, enter their name and the password, and can then mark picks, add links and edit the notes. The password is only used to sign into the shared Firebase account — nothing is stored beyond a session on their own browser.

---

## Everyday changes

- **Add or remove channels, searches, subreddits or feeds:** edit `config/sources.json` on GitHub. Channels use their YouTube `@handle`. Changes apply on the next run.
- **Steer tomorrow's list:** type in **Notes for tomorrow** on the website.
- **Run it again now:** go to **Actions → Daily react list → Run workflow**. If mods have already marked picks today, a re-run only adds new items and never wipes their marks.
- **Change the time:** edit the `cron` line in `.github/workflows/daily.yml`. The time is in UTC.
- **Change the mod password:** Firebase Console → Authentication → Users → delete the mod user, then add it again with the new password (step 3).

## Troubleshooting

- **The site says "Almost there":** `docs/config.js` still has the placeholder values.
- **The site says "Couldn't load data (403/404)":** `firestoreProjectId` in `docs/config.js` is wrong, or `firestore/firestore.rules` wasn't published.
- **Mod sign-in says "That password isn't right" but you're sure it's correct:** check that `modEmail` in `docs/config.js` exactly matches the email you used in Firebase Authentication → Users.
- **A run failed with "FIRESTORE_SERVICE_ACCOUNT is required":** the secret is missing or misspelled.
- **The summary says "YouTube handle not found":** that channel changed its @handle. Fix it in `config/sources.json`. You can also use the channel ID (starts with `UC`).
- **The summary says "Claude ranking (fell back to rules)":** the Anthropic key is missing, out of credit, or the API was busy. The list still gets made.
- **"Official page World of Warcraft: no articles found":** Blizzard changed its news page layout. Everything else keeps working; tell whoever maintains the code.
- **Scheduled runs stopped:** GitHub pauses schedules in quiet repos after 60 days. The job re-enables itself weekly, but if it ever stops, open Actions and click **Enable workflow**.
