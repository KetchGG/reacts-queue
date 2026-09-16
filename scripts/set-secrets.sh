#!/usr/bin/env bash
# Stores the project's secrets in GitHub without showing them on screen or to Claude.
# Run this yourself in a normal terminal window (not inside Claude Code):
#   bash scripts/set-secrets.sh
# Press Enter to skip any value you don't have yet; run the script again later to add it.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "The GitHub CLI (gh) isn't installed. Get it from https://cli.github.com and run: gh auth login"
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [ -z "$REPO" ]; then
  echo "Run this from inside the project folder after the GitHub repo exists."
  exit 1
fi
echo "Saving secrets to $REPO"
echo "(input is hidden; press Enter to skip)"
echo

ask_secret() {
  local name="$1" label="$2" value
  read -r -s -p "$label: " value; echo
  if [ -n "$value" ]; then
    printf '%s' "$value" | gh secret set "$name" --repo "$REPO" >/dev/null && echo "  ✓ $name saved"
  else
    echo "  – $name skipped"
  fi
}

ask_var() {
  local name="$1" label="$2" value
  read -r -p "$label: " value
  if [ -n "$value" ]; then
    gh variable set "$name" --repo "$REPO" --body "$value" >/dev/null && echo "  ✓ $name saved"
  else
    echo "  – $name skipped"
  fi
}

ask_secret SUPABASE_URL          "Supabase Project URL (https://….supabase.co)"
ask_secret SUPABASE_SECRET_KEY   "Supabase SECRET key (sb_secret_…)"
ask_secret YOUTUBE_API_KEY       "YouTube Data API key"
ask_secret ANTHROPIC_API_KEY     "Anthropic API key (sk-ant-…)"
ask_secret DISCORD_WEBHOOK_URL   "Discord webhook URL (optional)"
ask_secret REDDIT_CLIENT_ID      "Reddit client ID (optional, needs Reddit approval)"
ask_secret REDDIT_CLIENT_SECRET  "Reddit client secret (optional)"
ask_var    REDDIT_USER_AGENT     "Reddit user agent, e.g. xaryu-react-queue/1.0 (by /u/you) (optional, visible)"
ask_var    SITE_URL              "Website address, e.g. https://you.github.io/xaryu-react-queue/ (optional, visible)"
ask_var    ANTHROPIC_MODEL       "Claude model (optional, default claude-sonnet-5, visible)"

echo
echo "Done. Saved names (values are never shown):"
gh secret list --repo "$REPO"
