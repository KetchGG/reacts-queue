#!/usr/bin/env bash
# Reports which setup steps are done. Never prints secret values.
#   bash scripts/check-setup.sh
set -uo pipefail
ok()   { echo "  ✓ $*"; }
todo() { echo "  ✗ $*"; }

echo "Local"
command -v node >/dev/null && ok "Node $(node --version)" || todo "Node.js 20+ not installed (https://nodejs.org)"
command -v gh >/dev/null && ok "GitHub CLI installed" || todo "GitHub CLI not installed (https://cli.github.com)"
if npm test >/dev/null 2>&1; then ok "Tests pass"; else todo "Tests fail — run: npm test"; fi

echo "Website config (docs/config.js)"
if grep -qE 'YOUR-PROJECT|REPLACE_ME' docs/config.js; then todo "Still has placeholder values"; else ok "Filled in"; fi
if grep -qE '"private_key"|BEGIN PRIVATE KEY' docs/config.js; then todo "DANGER: a service-account key is in docs/config.js — that file is public, remove it"; fi

echo "GitHub"
if ! gh auth status >/dev/null 2>&1; then todo "Not signed in — run: gh auth login"; exit 0; fi
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [ -z "$REPO" ]; then todo "No GitHub repo linked to this folder yet"; exit 0; fi
ok "Repo: $REPO ($(gh repo view --json visibility -q .visibility))"
SECRETS="$(gh secret list --repo "$REPO" 2>/dev/null | awk '{print $1}')"
for s in FIRESTORE_SERVICE_ACCOUNT YOUTUBE_API_KEY ANTHROPIC_API_KEY; do
  echo "$SECRETS" | grep -qx "$s" && ok "Secret $s" || todo "Secret $s missing — run scripts/set-secrets.sh in your own terminal"
done
for s in DISCORD_WEBHOOK_URL REDDIT_CLIENT_ID; do
  echo "$SECRETS" | grep -qx "$s" && ok "Optional secret $s" || echo "  · Optional secret $s not set"
done
PAGES="$(gh api "repos/$REPO/pages" -q '.html_url + " (" + .status + ")"' 2>/dev/null || true)"
[ -n "$PAGES" ] && ok "Pages: $PAGES" || todo "GitHub Pages not enabled (Settings → Pages → main /docs)"
LAST="$(gh run list --repo "$REPO" --workflow daily.yml --limit 1 --json conclusion,createdAt -q '.[0] | (.conclusion // "running") + " at " + .createdAt' 2>/dev/null || true)"
[ -n "$LAST" ] && ok "Last daily run: $LAST" || todo "Daily workflow hasn't run yet — run: gh workflow run daily.yml"
