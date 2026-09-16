# Starting this project in Claude Code (WSL + VS Code)

## 1. Get the folder into WSL

In your WSL (Ubuntu) terminal:

```bash
mkdir -p ~/projects && cd ~/projects
unzip /mnt/c/Users/<YOUR-WINDOWS-NAME>/Downloads/xaryu-react-queue.zip
cd xaryu-react-queue
code .        # opens it in VS Code (WSL mode)
```

## 2. Make sure the tools are there

```bash
node --version     # needs v20 or newer
gh --version       # GitHub CLI
claude --version   # Claude Code
```

If any are missing:

- **Node 20+:** `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`
- **GitHub CLI:** `sudo apt install gh` (or see <https://cli.github.com>), then `gh auth login`
- **Claude Code:** `curl -fsSL https://claude.ai/install.sh | bash`

## 3. Start Claude Code and paste the kickoff prompt

```bash
claude
```

Then paste this:

---

> Read CLAUDE.md, README.md and SETUP.md so you understand this project. Then run `bash scripts/check-setup.sh` and `npm test`, and tell me where we are.
>
> Then walk me through first-time setup one step at a time, doing everything you can yourself and pausing when I need to do something in a browser:
>
> 1. Create a **public** GitHub repo named `xaryu-react-queue` from this folder with `gh repo create xaryu-react-queue --public --source . --push`. Do the initial git commit first.
> 2. Tell me exactly what to click to create a Firebase project, enable Firestore in **Production mode**, and publish `firestore/firestore.rules`.
> 3. Tell me how to enable Firebase Authentication (Email/Password) and add one shared mod user (email `mods@reacts-queue.local`, matching `docs/config.js`'s `modEmail`). Don't ask me for the password — I'll set it myself in the console.
> 4. Tell me how to download a service-account key (Project settings → Service accounts → Generate new private key) and find the Web API key and Project ID (Project settings → General).
> 5. Walk me through getting the YouTube Data API key and the Anthropic API key.
> 6. Tell me to run `bash scripts/set-secrets.sh` **in a separate terminal window** to store the keys and the downloaded service-account file. Never ask me to paste keys or the file's contents into this chat.
> 7. Put my Firebase project id and Web API key into `docs/config.js`, commit and push.
> 8. Turn on GitHub Pages from `main` / `/docs` using `gh api`, and give me the site URL. Save it as the `SITE_URL` variable with `gh variable set`.
> 9. Start the first run with `gh workflow run daily.yml`, watch it with `gh run watch`, and show me the run summary. Fix anything that fails, running `npm test` after every change.
> 10. When the site shows today's list, run `bash scripts/check-setup.sh` again and give me a short message I can send to the other mods (site link + how to sign in; I'll give them the password myself).
>
> Keep your explanations short. I'm comfortable with a terminal but new to Firebase and GitHub Actions.

---

## Useful follow-up prompts

- "Add the YouTube channel @SomeHandle to the creator list and do a dry run." *(set `YOUTUBE_API_KEY` in your shell first; the run uses whatever keys are in the environment)*
- "The last daily run had problems. Check `gh run view` and fix them."
- "Show me how much YouTube quota and Claude usage the last run used."
- "Move the daily run to 8 AM Eastern."
- "Reddit approved my API access. Help me turn it on."

## When the new site is live

Tell Claude in the Claude app (the conversation where the old board was built) to turn off the **"Xaryu react list (daily 9 AM ET)"** scheduled task, or pause it yourself in the app.
