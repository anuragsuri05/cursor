# AI Coding Agents: Knowledge Base
### Cursor · Claude Code · OpenAI Codex · OpenCode

**Researched:** 2026-10-14 from official docs, changelogs, GitHub repos and news coverage.
**Unverified items:** marked **[unverified]**; each section ends with a list of them.
**Keep in mind:** all four tools change fast, so confirm version-specific flags and keys with `--help` before relying on them.

---

## 0. Quick comparison

| | **Cursor** | **Claude Code** | **OpenAI Codex** | **OpenCode** |
|---|---|---|---|---|
| Vendor | Anysphere (acquired by SpaceX/xAI, announced Jun 2026) | Anthropic | OpenAI | SST / Anomaly (anomalyco), open source (MIT) |
| Primary form | VS Code-fork IDE + Agents Window | Terminal CLI (also IDE, desktop, web, Slack, CI) | CLI (Rust, Apache-2.0) + IDE ext + ChatGPT desktop + cloud | Terminal TUI (TS/Bun), client/server, desktop, IDE, web |
| Latest version seen | IDE 3.24 | 2.1.296 (2026-10-09) | rust-v0.162.1 (2026-10-09) | v1.19.0 (2026-10-11); OpenCode 2 in progress |
| Models | Composer 2.5 (own), Grok 4.7, Claude, GPT, Gemini, Kimi, GLM… | Claude only: Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 | GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol/Luna, GPT-5.6… | 75+ providers via models.dev / AI SDK; Zen / Go hosted |
| Project instructions | `.cursor/rules/*.mdc`, `AGENTS.md` (CLI also reads `CLAUDE.md`) | `CLAUDE.md` (+ `.claude/rules/`); falls back to `AGENTS.md` | `AGENTS.md` / `AGENTS.override.md` | `AGENTS.md`; falls back to `CLAUDE.md` |
| Main config | Customize page; `~/.cursor/cli-config.json` | `~/.claude/settings.json`, `.claude/settings(.local).json` | `~/.codex/config.toml` (TOML) | `opencode.json(c)`, `tui.json` |
| MCP config | `.cursor/mcp.json` / `~/.cursor/mcp.json` (`mcpServers`) | `.mcp.json` (`mcpServers`), `claude mcp add` | `[mcp_servers.x]` in config.toml, `codex mcp add` | `"mcp": {}` in opencode.json (`local` / `remote`) |
| Skills | `.cursor/skills/`, `.agents/skills/` (also reads `.claude/` and `.codex/` skills) | `.claude/skills/<n>/SKILL.md` | `.agents/skills/<n>/SKILL.md` | `.claude/skills` via `skill` tool |
| Subagents | `.cursor/agents/*.md` (also reads `.claude/agents`) | `.claude/agents/*.md` | Ultra effort fans out; `agents/openai.yaml` in skills | `.opencode/agents/*.md` (`mode: subagent`) |
| Hooks | `.cursor/hooks.json` (21 events, camelCase) | `hooks` in settings.json (33 events) | `~/.codex/hooks.json` or `[[hooks.X]]` (12 events) | JS/TS plugins (`tool.execute.before` …) |
| Permission model | Run modes: allowlist / auto-review / unrestricted + sandbox | default / acceptEdits / plan / auto / dontAsk / bypassPermissions | sandbox (read-only / workspace-write / danger-full-access) × approval (on-request / never) | allow / ask / deny per tool + glob patterns; `--auto` |
| Headless | `agent -p --output-format json` | `claude -p --output-format json` | `codex exec --json` | `opencode run --format json` |
| Cloud agents | Cloud Agents, Projects, Automations | claude.ai/code web sessions, routines | Codex Cloud (chatgpt.com/codex) | No hosted agents; self-host `opencode serve` |
| PR review | Bugbot | `/code-review`, GitHub Actions `@claude` | `@codex review` (posts P0/P1 only) | `/oc` GitHub Action |
| Price entry | Free / Pro $20 / Pro+ $60 / Ultra $200 | Pro / Max / Team / Enterprise or API | Free / Go $8 / Plus $20 / Pro $100–500 | Free (BYO keys); Go $10/$40; Zen pay-as-you-go |

**Cross-tool conventions:**
- **`AGENTS.md`** is read by all four.
- **`SKILL.md`** (Agent Skills format) is used by Claude Code, Codex and Cursor, and OpenCode reads `.claude/skills`.
- **MCP** is supported by all four.
- **Hook exit codes:** exit code `2` means "block" in Claude Code, Codex and Cursor.

---

## 1. Cursor

### 1.1 What it is
- **Product:** An AI-first code editor built on a VS Code fork (keeps VS Code keybindings and extensions). It runs on macOS 12+, Windows 10+ and Linux.
- **Two interfaces:**
  - The classic **Editor**.
  - The **Agents Window**, an agent-first workspace for many parallel local, cloud or SSH agents. It became generally available with Cursor 3 on 2026-04-02.
- **Other surfaces:** CLI (`agent`), web (cursor.com/agents), iOS app (Android uses a PWA), Slack/Teams/GitHub/GitLab/Linear/Jira integrations, an SDK (TypeScript/Python) and a Cloud Agents API.
- **Company:** Anysphere, founded 2022 (Truell, Asif, Lunnemark, Sanger **[founders from memory]**). SpaceX (merged with xAI) agreed to acquire it for about $60B on 2026-06-16; closing is reported for 2026-08-14 by one source only **[unverified]**. Grok models are now "jointly trained by Cursor and SpaceXAI".
- **New in 2026:**
  - **Origin:** git hosting/PR platform, beta from Aug 2026.
  - **Projects (beta):** a coordinator agent plus implementing agents.
  - **Security Review / Rollouts:** PR bots.
  - **Self-hosted workers.**
  - **iOS remote control** of local agents (Oct 6).
- **Docs:** cursor.com/docs (`docs.cursor.com` is legacy); index at cursor.com/llms.txt.

### 1.2 Architecture
- **Agent:** instructions (system prompt + rules) + tools + model.
  - **Tools:** grep/file search, web search, fetch rules, read files and images, edit, shell, browser, image generation (to `assets/`), ask questions. No tool-call limit.
  - **Built-in subagents:** *Explore* (fast model, up to 10 parallel searches) and *Browser*.
- **Indexing:** Semantic embeddings indexing is being retired in favor of **Instant Grep / ripgrep** (forum, 2026-07-22). The indexing settings page has been removed.
- **Privacy:**
  - **Privacy Mode:** zero data retention, no training. Default for Enterprise.
  - **"Privacy Mode (Legacy)":** blocks Cloud Agents, Projects, iOS and sharing.
  - Cloud Agents store encrypted repo copies for the duration of the run.
  - Some models (e.g. Claude Fable 5/5.1) require a data-retention opt-in.
  - Encryption: TLS 1.2+ in transit, AES-256 at rest, CMEK on Enterprise.
- **Run modes:** sandbox, plus an approval mode of allowlist, auto-review or unrestricted. Protected paths: `.git/config`, `.git/hooks`, `.vscode`, `.cursorignore`.

### 1.3 Features
| Feature | Notes |
|---|---|
| **Tab** | Own next-edit autocomplete model; Tab accepts, Cmd+→ accepts the next word. Unlimited on Pro+. Rules don't apply to Tab. |
| **Agent** (formerly Composer/Chat) | Cmd+I / Cmd+L. Multi-file edits, terminal, tools, checkpoints. Enter queues a message; Cmd+Enter sends now. Side chats via `/side` or `/btw`; `/goal <objective>`. |
| **Modes** | Agent, Ask (read-only), Plan, Debug, Design, plus Custom Modes (a skill invoked with Opt+Enter). Shift+Tab rotates. "Manual" mode is gone. |
| **Plan Mode** | Researches, asks questions, writes an editable Markdown plan and waits for approval. Plans save to the home directory unless you choose "Save to workspace". |
| **Inline Edit Cmd+K** | Edit a selection. Opt+Return asks a quick question. In the terminal it opens the command bar. User Rules don't apply. |
| **Cloud Agents** (formerly Background) | Isolated VMs set up with a snapshot, a Dockerfile, or `.cursor/environment.json`. Open PRs with screenshots and video; remote desktop and computer use; multi-repo. Start from desktop, web, iOS, Slack `@cursor`, GitHub `@cursor`, Linear, the API, or the CLI with an `&` prefix. Self-hosted: `agent worker start`. |
| **Projects (beta)** | Coordinator agent with delegated agents and shared context files. Triggered by Slack, schedules or PRs. Paid plans only. |
| **Parallel agents** | Worktrees at `~/.cursor/worktrees/<repo>/<name>`; setup in `.cursor/worktrees.json`. `/in-cloud`, `/autopilot`. |
| **Subagents** | `.cursor/agents/*.md` and `~/.cursor/agents/`; also reads `.claude/agents`, `.codex/agents`. Frontmatter: `name`, `description`, `model` (`inherit` or e.g. `composer-2.5[fast=false]`), `readonly`, `is_background`. |
| **Bugbot** | PR review on GitHub, GitLab, Bitbucket, Azure DevOps and Origin. Trigger with a `cursor review` or `bugbot run` comment. Config in `.cursor/config/bugbot.yaml`, rules in `.cursor/BUGBOT.md` (can be nested). Optional Autofix. Findings are `neutral` by default and don't block merges unless you enable fail-on-unresolved. |
| **Automations** | Agents run on schedules, Slack or GitHub events (`/automate`). Per-automation memory in `MEMORIES.md`. |
| **Browser / Canvas** | Built-in browser the agent can drive. `/canvas` creates interactive React artifacts. |
| **IDE "Memories"** | Not in the current docs; likely removed late 2025 **[unverified]**. |

### 1.4 Configuration
Everything is managed on the sidebar **Customize** page (plugins, rules, skills, MCP, subagents, commands, hooks), at user, workspace or team scope.

**Rules:** `.cursor/rules/**/*.mdc`
- Plain `.md` files in that folder are ignored.
- **User rules** (in Settings) apply to Agent only.
- **Team rules** are set in the dashboard.
- **Precedence:** Team → Project → User; all applicable rules are merged.
- **`AGENTS.md`:** plain Markdown with no frontmatter; nested files apply to their subtree.
- Legacy `.cursorrules` is not in the docs **[unverified whether still read]**.
- Create rules with `/create-rule` in chat or `agent generate-rule` in the CLI. Keep each rule under 500 lines and use `@file` references instead of pasting content.

| alwaysApply | description | globs | Type |
|---|---|---|---|
| true | – | – | Always Apply |
| false | – | set | Auto-attached to matching files |
| false | set | – | Agent decides |
| false | – | – | Manual (@-mention) |

```md
---
description: "React component conventions"
globs: src/**/*.tsx, packages/ui/**/*.ts
alwaysApply: false
---
- Use function components and named exports.
- Reference @component-template.tsx for structure.
```

**Skills**
- **Locations:** `.cursor/skills/`, `.agents/skills/`, `~/.cursor/skills/`, `~/.agents/skills/`; also loads `.claude/skills/` and `.codex/skills/`.
- **Format:** `<name>/SKILL.md`. Frontmatter: `name` (must match the folder), `description`, `paths`, `disable-model-invocation`, `icon`, `color`, `metadata`.
- **Built-ins:** `/automate`, `/autopilot`, `/canvas`, `/create-hook|rule|skill|subagent`, `/loop`, `/migrate-to-skills`, `/review`, `/review-bugbot`, `/review-security`, `/split-to-prs`, `/update-cursor-settings`.

**Commands:** Markdown prompts invoked with `/`. Historical location is `.cursor/commands/*.md` (or `~/.cursor/commands/`) **[path not confirmed in current docs]**. `/migrate-to-skills` converts them to skills.

**Ignore files**
- **`.cursorignore`** (`.gitignore` syntax) hides files from Agent, Tab, Inline Edit and @-mentions.
  - **Not secure:** the terminal and MCP tools can still read ignored files.
  - **Defaults:** `.gitignore` entries plus lockfiles, `.env*`, `.git/`, `node_modules/` and binaries are already ignored.
- **`.cursorindexingignore`** is probably moot now that semantic indexing is being retired **[unverified]**.

**MCP:** `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)
- Transports: stdio, SSE, Streamable HTTP. OAuth supported.
- Variables: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`.
- The CLI and Cloud Agents read the same file.
```json
{ "mcpServers": {
    "local-db": { "type": "stdio", "command": "npx", "args": ["-y","@example/db-mcp"],
                  "env": { "DB_URL": "${env:DB_URL}" }, "envFile": "${workspaceFolder}/.env" },
    "remote-api": { "url": "https://api.example.com/mcp",
                    "headers": { "Authorization": "Bearer ${env:API_TOKEN}" } } } }
```

**Hooks**
- **Locations:** `.cursor/hooks.json`, `~/.cursor/hooks.json`, Team dashboard, MDM (`/Library/Application Support/Cursor/hooks.json`, `/etc/cursor/hooks.json`).
- **Precedence:** Enterprise > Team > Project > User. Deny beats ask beats allow.
- **Exit codes:** 0 is OK (stdout JSON is used); 2 blocks; anything else fails open unless `failClosed` is set.
- **Events:** sessionStart/End, preToolUse, postToolUse(Failure), subagentStart/Stop, before/afterShellExecution, before/afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought, beforeTabFileRead, afterTabFileEdit, workspaceOpen.
- **Cloud Agents** run project hooks only.
```json
{ "version": 1, "hooks": {
    "afterFileEdit": [{ "command": ".cursor/hooks/format.sh" }],
    "beforeShellExecution": [{ "command": ".cursor/hooks/guard.sh", "matcher": "git|kubectl", "failClosed": true }] } }
```
Permission output example: `{"permission":"deny","user_message":"…","agent_message":"…"}`.

**Plugins:** `.cursor-plugin/plugin.json` bundles rules, agents, commands, hooks, MCP and skills. A team marketplace uses `.cursor-plugin/marketplace.json`.

**CLI config:** `~/.cursor/cli-config.json` (global); project `.cursor/cli.json` holds permissions only.
```json
{ "version": 1, "editor": { "vimMode": false },
  "permissions": { "allow": ["Shell(ls)","Shell(git)"], "deny": ["Shell(rm)","Read(.env*)"] } }
```
- Permission tokens: `Shell(x)`, `Read(glob)`, `Write(glob)`, `WebFetch(domain)`.
- Other fields: `approvalMode` (allowlist|auto-review|unrestricted), `sandbox.*`, `attribution.attributeCommitsToAgent`.

**Bugbot config**
```yaml
# .cursor/config/bugbot.yaml (read from PR base branch)
version: 1
triggers: { drafts: false, frequency: everyPush }   # everyPush | oncePerPr
review: { effort: default, incremental: true }       # low|default|high|smart
prSummary: { mode: comment, riskScore: true }
autofix: { mode: disabled }                          # disabled|newBranch|existingBranch
```
Cursor Settings: Cmd+Shift+J. VS Code settings: Cmd+,. Cloud environment: `.cursor/environment.json`.

### 1.5 Models
- **Cursor Models pool** (larger included usage):
  - **Composer 2.5:** own model, built on a Kimi K2.5 base plus about 85% Cursor RL compute. $0.5/$2.5 per M tokens; Fast variant (the default) $3/$15.
  - **Grok 4.7:** 256k context (500k long), effort low–xhigh. $2/$6; Fast $4/$12.
  - **Grok 4.6 and 4.5.**
- **Other Models pool** (billed at API rates):
  - **Anthropic:** Claude Opus 5.5 ($4/$20, 1M context), Sonnet 5.5, Haiku 5.5, Fable 5/5.1.
  - **OpenAI:** GPT-5.6 Sol/Terra/Luna, GPT-5.5.
  - **Google:** Gemini 4 Argon, 3.1 Pro.
  - **Others:** Kimi K3, GLM 5.x, Meta Muse Spark.
- **Auto / Cursor Router:** Cost, Balance or Intelligence modes. Third-party models add a $0.25/M "Cursor Token Rate" on Teams/Enterprise.
- **Max Mode:** legacy request-based plans only.
- **Model parameter syntax:** `claude-opus-5[effort=high,context=300k]`.

### 1.6 Keyboard shortcuts (Mac; use Ctrl elsewhere)
| Key | Action |
|---|---|
| Cmd+I / Cmd+L | Agent panel (Cmd+L adds the selection) |
| Cmd+E | Agent layout |
| Cmd+. | Mode menu |
| Shift+Tab | Rotate modes |
| Cmd+/ | Cycle models |
| Cmd+K | Inline edit / terminal command bar |
| Cmd+Shift+L | Add selection to chat |
| Cmd+Shift+K | Add selection to edit |
| Tab / Cmd+→ | Accept suggestion / accept next word |
| Enter / Cmd+Enter | Queue / send now (Cmd+Enter also accepts all changes) |
| Cmd+Shift+Backspace | Cancel / reject all |
| Cmd+N, Cmd+T, Cmd+[ / ], Cmd+W | New chat, new tab, previous/next, close |
| Cmd+Shift+J | Cursor settings |
| Cmd+Shift+Space | Voice |
| Cmd+Shift+P | Command palette (Open Agents Window) |

### 1.7 CLI (`agent`, formerly `cursor-agent`)
- **Install:** `curl https://cursor.com/install -fsS | bash`, or on Windows `irm 'https://cursor.com/install?win32=true' | iex`. Make sure `~/.local/bin` is on your PATH.
- **Subcommands:**
  - Sessions: `agent [prompt]`, `ls`, `resume`, `create-chat`.
  - Account: `login`, `logout`, `status`, `about`.
  - Models: `models`.
  - MCP: `mcp list|list-tools|login|enable|disable`.
  - Sandbox: `sandbox enable|disable|reset|run`.
  - Workers: `worker start|debug`.
  - Other: `acp`, `update`, `generate-rule`, `install-shell-integration`.
- **Flags:**
  - Scripting: `-p/--print`, `--output-format text|json|stream-json`, `--stream-partial-output`.
  - Model and mode: `--model`, `--list-models`, `--mode plan|ask`, `--plan`.
  - Sessions: `--resume [id]`, `--continue`.
  - Permissions: `-f/--force` (alias `--yolo`), `--sandbox enabled|disabled`, `--approve-mcps`, `--trust`.
  - Workspace: `--workspace`, `-w/--worktree [name]`.
  - Auth and plugins: `--api-key` / `CURSOR_API_KEY`, `--plugin-dir`.
- **Slash commands:** `/model`, `/plan`, `/ask`, `/debug`, `/goal`, `/max-mode`, `/resume`, `/fork`, `/rewind`, `/summarize` (alias `/compress`), `/clear`, `/run-everything`, `/shell`, `/mcp`, `/plugin`, `/sandbox`, `/config`, `/vim`.
- **Other features:**
  - An `&` prefix hands the prompt to a Cloud Agent.
  - Ctrl+R reviews diffs.
  - Print mode has full write access, so pair it with permissions.
  - The CLI reads `.cursor/rules`, `AGENTS.md`, `CLAUDE.md` and `mcp.json`.

### 1.8 Pricing (docs; verify first)
| Plan | Price | Notes |
|---|---|---|
| Hobby | Free | Limited; no Cloud Agents or Projects |
| Start (India only) | ₹649/mo | Cursor Models pool only |
| Pro | $20/mo | Both pools, unlimited Tab, Bugbot, Cloud Agents |
| Pro Plus | $60/mo | More usage |
| Ultra | $200/mo | Most usage |
| Teams | $40/user (Standard), $120/user (Premium, 5× limits) | SSO, team privacy |
| Enterprise | Custom | Pooled usage, SCIM, audit logs |

- **Usage:** two monthly pools (Cursor Models and Other Models); overage at API rates. The docs estimate daily Agent users at about $60–100/mo.
- **⚠ Pricing conflict:** on 2026-10-14, cursor.com/pricing showed an X/Grok bundle (Plus $8, Premium $30, Super $100, Ultra $200). This conflicts with the docs and may be a leaked plan or a test.

### 1.9 Best practices and limitations
- **Plan before big changes.** Use Plan Mode for multi-file work. If the result drifts, revert, refine the plan and rerun rather than patching.
- **Keep instructions scoped.** Use small, glob-scoped rules or `AGENTS.md`. Turn repeatable workflows into skills and isolated work into subagents.
- **Let the agent search.** @-mention only files you know matter, and run `/summarize` when the context fills.
- **Verify the work.** Have the agent run tests, lint and type-checks. Use checkpoints for quick rollback and git for anything permanent.
- **Invest in Cloud Agent environments** so cloud agents can test their own work.
- **Secrets:** `.cursorignore` alone isn't enough. Add deny permissions, `beforeReadFile`/`beforeShellExecution` hooks and the sandbox.
- **Limitations:**
  - Rules don't affect Tab, and User Rules don't affect Inline Edit.
  - Grep-only retrieval may weaken concept-level search in large codebases.
  - Legacy Privacy Mode blocks the cloud features.
  - Ownership changes may shift models and pricing.

---

## 2. Claude Code (Anthropic)

### 2.1 What it is and where it runs
Claude Code is Anthropic's agentic coding tool. Its agent loop reads and edits files, runs shell commands, uses MCP tools, delegates to subagents and can run multi-agent workflows.

**Surfaces:**
- CLI (`claude`, `claude -p`)
- VS Code extension and JetBrains plugin
- Desktop app (Code tab: diff review, parallel sessions, worktrees)
- Web: **claude.ai/code** (cloud sessions on Anthropic infrastructure, connected to GitHub)
- Slack
- GitHub Actions and GitLab CI (`@claude`)
- Remote Control: drive a local session from claude.ai or mobile

**Docs:** code.claude.com/docs (index at code.claude.com/docs/llms.txt).

### 2.2 Install and auth
```bash
curl -fsSL https://claude.ai/install.sh | bash        # native, auto-updates (recommended)
irm https://claude.ai/install.ps1 | iex               # Windows
brew install --cask claude-code | winget install Anthropic.ClaudeCode | npm i -g @anthropic-ai/claude-code
claude --version; claude doctor; claude update
claude auth login [--console|--sso]; claude auth status; claude setup-token   # CI token -> CLAUDE_CODE_OAUTH_TOKEN
```
- **Update channel:** `"autoUpdatesChannel": "stable" | "latest"`. Homebrew, WinGet and Linux package-manager installs don't auto-update.
- **Accounts:** Pro, Max, Team, Enterprise or Console (API). The free claude.ai plan has no Claude Code access.
- **Auth precedence:** Bedrock/Vertex/Foundry env vars > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > `/login` subscription.

### 2.3 Models, effort and fast mode
| Alias | Model |
|---|---|
| `fable` | Claude Fable 5.1 (`claude-fable-5-1`); needs Fable access |
| `best` | Fable if available, otherwise Opus |
| `opus` | Opus 5.5 (`claude-opus-5-5`) |
| `sonnet` | Sonnet 5.5 (`claude-sonnet-5-5`) |
| `haiku` | Haiku 5.5 (`claude-haiku-5-5`); 1M context; default Haiku since 2.1.293 |
| `opusplan` | Opus for planning, Sonnet for execution |
| `opus[1m]`, `sonnet[1m]` | 1M-context variants |

- **Choosing a model:** `/model` > `--model` > `ANTHROPIC_MODEL` > `model` in settings.
- **Effort:** `low|medium|high|xhigh|max` via `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` or `effortLevel`. The 5.5 models default to medium. `ultrathink` in a prompt boosts one turn.
- **Fast mode** (`/fast`, Opt/Alt+O, `"fastMode": true`): same Opus model, faster output. Opus 5.5 only, at $8/$40 per MTok. On subscriptions it draws from usage credits.

### 2.4 Permissions
| Mode | Runs without asking |
|---|---|
| `default` (Manual) | Reads only |
| `acceptEdits` | Reads, file edits, mkdir/touch/mv/cp |
| `plan` | Read-only exploration |
| `auto` | Everything, with a classifier reviewing each action (default for interactive sessions since v2.1.283) |
| `dontAsk` | Pre-approved tools only; everything else is denied (CI) |
| `bypassPermissions` | Everything except protected actions; use only in containers or VMs |

- **Switching:** Shift+Tab cycles modes. Set the start mode with `--permission-mode` or `permissions.defaultMode`.
- **Rules:** written as `Tool(specifier)`. Deny wins over ask and allow.
```json
{ "permissions": { "allow": ["Bash(npm run test *)", "Read"],
                   "deny": ["Read(./.env)", "Read(./.env.*)", "WebFetch"] } }
```

### 2.5 Memory: CLAUDE.md and auto memory
**CLAUDE.md files** are concatenated, not overridden:

| Scope | Path |
|---|---|
| Managed | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/CLAUDE.md` (Linux) |
| User | `~/.claude/CLAUDE.md` |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` |
| Local (gitignored) | `./CLAUDE.local.md` |

- **Loading:** files in parent directories load at launch; subdirectory files load on demand.
- **Imports:** `@path`, up to 4 hops deep.
- **Path-scoped rules:** `.claude/rules/*.md` with `paths:` frontmatter, or `~/.claude/rules/` for all projects.
- **Size:** keep each file under about 200 lines. Check what loaded with `/context` and `/memory`.
- **`AGENTS.md`** is used if there's no CLAUDE.md.

**Auto memory:** `~/.claude/projects/<project>/memory/` with a `MEMORY.md` index; the first 200 lines / 25KB load each session. Set `autoMemoryEnabled` or `autoMemoryDirectory`, or toggle with `/memory`.

### 2.6 Settings
Precedence, highest first:
1. Managed settings
2. `--settings` on the command line
3. `.claude/settings.local.json`
4. `.claude/settings.json`
5. `~/.claude/settings.json`

Arrays merge across layers; scalars are overridden. Settings files are strict JSON (no comments or trailing commas).
```json
{ "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "opus", "outputStyle": "Explanatory", "autoUpdatesChannel": "stable",
  "permissions": { "defaultMode": "acceptEdits", "allow": ["Bash(npm run lint)"], "deny": ["Read(./.env)"] },
  "env": { "DISABLE_AUTOUPDATER": "1" },
  "statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 2 },
  "hooks": {} }
```

### 2.7 Slash commands (highlights)
- **Session:** `/clear`, `/compact [focus]`, `/resume`, `/rename`, `/branch`, `/fork`, `/rewind` (aliases `/checkpoint`, `/undo`), `/export`.
- **Config:** `/config`, `/model`, `/effort`, `/fast`, `/theme`, `/output-style`, `/permissions`, `/hooks`, `/plugin`, `/mcp`, `/memory`, `/init`, `/statusline`, `/keybindings`, `/login`.
- **Context and cost:** `/context`, `/usage` (alias `/cost`), `/doctor`, `/status`, `/insights`, `/skill-doctor`.
- **Work:** `/plan`, `/review`, `/code-review`, `/security-review`, `/diff`, `/simplify`, `/batch`, `/verify`, `/run`, `/debug`.
- **Agents and automation:** `/agents`, `/tasks`, `/background`, `/loop`, `/goal`, `/schedule`, `/workflows`, `/deep-research`, `/ultrareview` (a deprecated alias of `/code-review ultra`), `/add-dir`.
- **Integrations:** `/chrome`, `/ide`, `/desktop`, `/remote-control`, `/install-github-app`, `/install-slack-app`, `/teleport`.

### 2.8 Skills
- **Locations:** `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, or plugin `skills/` (invoked as `/plugin:skill`).
- **Frontmatter:** `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`.
- **Substitutions:** `$ARGUMENTS`, `$0..$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`; `` !`cmd` `` injects command output.
- **Size:** keep `SKILL.md` under 500 lines.
```markdown
---
name: pr-review
description: Review a GitHub pull request. Use when asked to review a PR.
argument-hint: "[pr-number]"
allowed-tools: Bash(gh pr *) Read Grep Glob
context: fork
agent: Explore
---
Review PR $0. Current diff: !`gh pr diff $0`
```

### 2.9 Subagents
- **Location:** `.claude/agents/*.md` or `~/.claude/agents/`, or `--agents` JSON. Only `name` and `description` are required.
- **Other fields:** `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `memory` (user|project|local), `isolation: worktree`, `effort`, `skills`, `mcpServers`, `hooks`, `background`, `color`, `initialPrompt`, `omitClaudeMd`.
- **Built-ins:** Explore (read-only), Plan, general-purpose, statusline-setup, claude-code-guide.
- **Managing:** `/agents`. Disable one with `permissions.deny: ["Agent(Explore)"]`.
```markdown
---
name: code-reviewer
description: Reviews code after changes. Use proactively after edits.
tools: Read, Grep, Glob, Bash
model: sonnet
isolation: worktree
---
You are a senior reviewer. Run git diff, report findings by severity with file:line.
```

### 2.10 Hooks
- **33 events:** SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd.
- **Handler types:** `command`, `http`, `mcp_tool`, `prompt`, `agent` (experimental).
- **Exit codes:** 0 is OK (stdout JSON is parsed); 2 blocks (stderr is fed back to Claude); anything else is a non-blocking error.
- **Input:** stdin JSON with `tool_name`, `tool_input`, `session_id`, `cwd`, `permission_mode`.
- **Output:** `hookSpecificOutput.permissionDecision`: allow | deny | ask | defer.
- **Locations:** settings.json, plugin `hooks/hooks.json`, or skill/agent frontmatter. View with `/hooks`.
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "if": "Bash(rm *)", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh", "timeout": 30 } ] } ] } }
```

### 2.11 MCP
```bash
claude mcp add --transport http notion https://mcp.notion.com/mcp
claude mcp add --transport stdio --env KEY=value airtable -- npx -y airtable-mcp-server
claude mcp add --transport http --scope project sentry https://mcp.sentry.dev/mcp
claude mcp list | get | remove | login | logout
```
- **Scopes:** `local` (default, in `~/.claude.json`, this project), `project` (committed `.mcp.json`), `user` (`~/.claude.json`, all projects).
- **Precedence:** local > project > user > plugin > claude.ai connectors. Entries don't merge across scopes.
- **Output limits:** warning at 10k tokens, max 25k (`MAX_MCP_OUTPUT_TOKENS`).
- **Tool search** defers MCP tool definitions until needed.
```json
{ "mcpServers": { "api-server": { "type": "http",
    "url": "${API_BASE_URL:-https://api.example.com}/mcp",
    "headers": { "Authorization": "Bearer ${API_KEY}" } } } }
```

### 2.12 Plugins, output styles, status line
- **Plugins:**
  - **Manifest:** `.claude-plugin/plugin.json`.
  - **Contents:** `skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `workflows/`, `output-styles/`.
  - **Marketplace catalog:** `.claude-plugin/marketplace.json`.
  - **Install:** `claude plugin install code-review@claude-plugins-official` or the `/plugin` Discover tab.
  - **Development:** `--plugin-dir ./my-plugin`, then `/reload-plugins` to pick up changes.
- **Output styles:**
  - **Built-ins:** Default, Proactive, Concise, Explanatory, Learning.
  - **Custom:** Markdown files in `~/.claude/output-styles/` or `.claude/output-styles/`.
- **Status line:** `statusLine.command` gets session JSON on stdin. Useful fields: `model.display_name`, `context_window.used_percentage`, `cost`, `rate_limits.five_hour.used_percentage`.

### 2.13 Headless mode and CLI
```bash
claude -p "Fix the bug in auth.py" --allowedTools "Read,Edit,Bash"
cat build.log | claude -p "explain the root cause"
claude -p "Summarize" --output-format json | jq -r '.result'
claude -p "List functions" --output-format json --json-schema '{...}'   # -> structured_output
claude -p "q" --output-format stream-json --verbose --include-partial-messages
claude --bare -p "q" --allowedTools "Read"     # skip hooks/skills/plugins/MCP/CLAUDE.md for scripts
claude -c -p "..."  ;  claude -r "session-name" "..."
```
- **Output and limits:** `--output-format`, `--json-schema`, `--max-turns`, `--max-budget-usd`.
- **Model and permissions:** `--model`, `--effort`, `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--tools`, `--permission-prompts none`.
- **Prompt and config:** `--append-system-prompt(-file)`, `--system-prompt(-file)`, `--add-dir`, `--mcp-config`, `--strict-mcp-config`, `--settings`, `--agents`, `--plugin-dir`.
- **Sessions:** `-c`, `-r`, `--fork-session`, `--session-id`, `-n`.
- **Isolation and troubleshooting:** `-w/--worktree`, `--bg`, `--bare`, `--safe-mode`.
- **Subcommands:** `update`, `auth`, `mcp`, `plugin`, `agents`, `attach|logs|stop|respawn|rm`, `doctor`, `setup-token`, `ultrareview`, `remote-control`.

### 2.14 Agent SDK, checkpoints, worktrees, background work, workflows
- **Agent SDK:**
  - Packages: Python `claude-agent-sdk`, TypeScript `@anthropic-ai/claude-agent-sdk`.
  - What it is: the Claude Code harness (built-in tools, permissions, sessions, hooks, subagents, MCP) running in your own app. Use API-key auth.
  - Not the same as Managed Agents (Anthropic-hosted) or the API Tool Runner (your tools only).
- **Checkpoints:**
  - A snapshot is taken before each turn; the last 100 are kept.
  - Restore with `/rewind` or Esc Esc on an empty prompt.
  - Not tracked: Bash file operations, most subagent edits, and changes made outside Claude Code. Use git for those.
- **Worktrees:**
  - `claude -w feature-auth` creates `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>`.
  - Add `.claude/worktrees/` to `.gitignore`. `.worktreeinclude` copies gitignored files such as `.env` into new worktrees.
  - `worktree.baseRef` is `fresh` or `head`.
- **Background sessions:** `claude --bg "..."` or `/background`. Manage them with `claude agents`, `claude attach <id>` and `claude logs <id>`; Ctrl+B backgrounds running tasks.
- **Workflows:**
  - JavaScript scripts that orchestrate subagents with `agent()`, `parallel()`, `pipeline()` and `phase()`.
  - Triggered by the `ultracode` keyword or `/effort ultracode`. Saved in `.claude/workflows/`. Watched with `/workflows`.
  - Limits: 16 concurrent agents, 1,000 per run. `/deep-research` is a bundled workflow.
- **Scheduling and teams:** `/loop` for recurring prompts, `/schedule` for cloud routines. Agent teams are experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

### 2.15 Keyboard shortcuts
| Key | Action |
|---|---|
| Shift+Tab | Cycle permission modes |
| Esc / Esc Esc | Interrupt / rewind menu |
| Ctrl+C / Ctrl+D | Interrupt / exit |
| Ctrl+B | Background running tasks |
| Ctrl+O | Transcript |
| Ctrl+R | Search history |
| Ctrl+G | Edit the prompt in your editor |
| Ctrl+T | Task list |
| Ctrl+S | Stash the prompt |
| Ctrl+V | Paste image |
| Opt/Alt+P | Switch model |
| Opt/Alt+T | Toggle thinking |
| Opt/Alt+O | Toggle fast mode |
| Ctrl+Enter | Send queued messages now |

- **Input prefixes:** `/` commands, `!` shell, `@` files, `?` help.
- **Customizing:** `~/.claude/keybindings.json` via `/keybindings`.

### 2.16 Pricing and best practices
- **Plans:** included with Pro, Max, Team and Enterprise; per-token on Console/API or cloud providers.
- **Typical cost:** about $13 per developer per active day ($150–250/month); 90% of users stay under $30/day. Track with `/usage`.
- **Best practices:**
  - Give Claude ways to verify its work (tests, expected output, screenshots).
  - Plan before multi-file changes.
  - Keep CLAUDE.md short and move procedures into skills.
  - Run `/clear` between unrelated tasks, and use `/rewind` to recover from a bad path.
  - Use subagents for verbose work and worktrees for parallel sessions.
  - Use hooks for guarantees instead of instructions in prose.
  - For CI, use `--bare`, explicit `--allowedTools`, `dontAsk` and `--max-budget-usd`.
- **Unverified:** legacy `.claude/commands/` handling and the exact Agent SDK `query()` signatures.

---

## 3. OpenAI Codex

### 3.1 What it is
- **Today's Codex** is OpenAI's agentic software-engineering product: it reads repos, edits, runs commands in a sandbox, reviews code and opens PRs.
- **Not the 2021 Codex model.** That GPT-3 descendant behind early Copilot (`code-davinci-002`) was deprecated in 2023. The `*-codex` model variants (gpt-5-codex …) have since been deprecated too.
- **Open source:** the CLI is at github.com/openai/codex (Apache-2.0; Rust core in `codex-rs/`). The latest release is **rust-v0.162.1** (2026-10-09); npm `@openai/codex` and `@openai/codex-sdk` are also 0.162.1.
- **Docs:** `developers.openai.com/codex/*` now redirects to `learn.chatgpt.com/docs/*`.
- **⚠ Changed a lot in 2026.** Older guides are often stale on `--full-auto`, `[profiles.x]`, `codex mcp-server`, the `untrusted` policy and custom prompts.

### 3.2 Surfaces
- **CLI** (`codex`, plus `codex exec` for scripts).
- **IDE extension** (`openai.chatgpt`) for VS Code, Cursor and Windsurf; Xcode and JetBrains have their own integrations.
- **Desktop:** macOS (Feb 2026), then Windows; **merged into the ChatGPT desktop app on 2026-07-09** as a Codex view. `codex app` opens it.
- **Codex Cloud:** chatgpt.com/codex, iOS.
- **Code review** on GitHub and GitLab (GitLab is Beta).
- **SDK, app server and GitHub Action** (`openai/codex-action@v1`).
- **Slack and Linear.**
- Codex shares one usage pool with ChatGPT Work.

### 3.3 Install and auth
```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh     # rerun to update
npm install -g @openai/codex   |   brew install --cask codex
codex update; codex doctor
codex login                         # ChatGPT OAuth (recommended; required for cloud/review/Slack)
codex login --device-auth           # headless
printenv OPENAI_API_KEY | codex login --with-api-key   # API rates; CLI/SDK/IDE only, no cloud
codex login status; codex logout
```
- **Credential storage:** `cli_auth_credentials_store` = file (`$CODEX_HOME/auth.json`) | keyring | auto | ephemeral.
- **Headless login:** device auth, copy `auth.json` from another machine, or forward port 1455 over SSH.
- **Admin enforcement:** `forced_login_method`, `forced_chatgpt_workspace_id`.

### 3.4 Models (Oct 2026)
| Model | Notes |
|---|---|
| `gpt-6-astra` | Strongest |
| `gpt-6.1-sol` | Released 2026-09-29. Recommended; Ultrafast mode on Pro $500 |
| `gpt-6-sol`, `gpt-6-luna` | Released 2026-09-22. Luna is the efficient, high-volume model |
| GPT-5.6 Sol/Terra/Luna | Still available |
| `gpt-5.5` | Retired from Codex with ChatGPT sign-in on 2026-10-14; still on the API |

- **Retired:** gpt-5.4 (Aug 31), gpt-5.3-codex-spark (Sep 14).
- **Reasoning effort:** Light/Low, Medium, High, Extra High, Max, Ultra (fans out to subagents). Set with `/model`, `/reasoning`, `-m` or `model_reasoning_effort`.
- **Local models:** `--oss --local-provider lmstudio|ollama`.

### 3.5 Sandbox and approvals
- **`sandbox_mode` / `-s`:**
  - `read-only`
  - `workspace-write` (the default for interactive work)
  - `danger-full-access`
- **`approval_policy` / `-a`:**
  - `on-request`
  - `never`
  - `{ granular = {...} }`
  - **`untrusted` is retired and `on-failure` is deprecated.**
- **Auto review:** `approvals_reviewer = "auto_review"` sends prompts to a reviewer agent; `/approve` retries a denial.
- **`/permissions` presets:**
  - Ask for approval: workspace-write + on-request.
  - Approve for me: adds auto_review.
  - Full access: danger-full-access + never.
  - Custom.
- **Flags and settings:**
  - `--full-auto` is deprecated; use `--sandbox workspace-write`.
  - `--yolo` (alias of `--dangerously-bypass-approvals-and-sandbox`) turns everything off; use it only in hardened containers.
  - `--add-dir`, plus `sandbox_workspace_write.writable_roots` / `.network_access` in config.
- **OS sandboxes:**
  - macOS: Seatbelt.
  - Linux/WSL2: bubblewrap (needs unprivileged user namespaces).
  - Windows: `[windows] sandbox` = `mxc` (recommended; Win11 24H2 26100.9278+), `elevated` or `unelevated`.
  - Test with `codex sandbox -- <cmd>`.
- **Command rules** (experimental execpolicy): Starlark files in `~/.codex/rules/*.rules`. Test with `codex execpolicy check --rules f -- cmd`.
```python
prefix_rule(pattern=["gh","pr","view"], decision="prompt",   # allow | prompt | forbidden
            justification="Viewing PRs needs approval")
```

### 3.6 Config: `~/.codex/config.toml`
- **`CODEX_HOME`** defaults to `~/.codex` (config.toml, auth.json, history.jsonl, logs).
- **Layering, lowest to highest:**
  1. `~/.codex/config.toml`
  2. A profile file, `~/.codex/<name>.config.toml` (`--profile <name>`)
  3. Project `.codex/config.toml` (**trusted projects only**)
  4. CLI flags and `-c key=value` overrides
  - Managed `requirements.toml` policies sit above all of these.
- **Profiles changed in 0.134.0:** `[profiles.x]` tables and the `profile=` key were removed; each profile is now its own file.
- **User-level only:** `openai_base_url`, `model_provider(s)`, `notify`, `otel`.
```toml
model = "gpt-6.1-sol"
model_reasoning_effort = "medium"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
notify = ["python3", "/Users/me/.codex/notify.py"]
project_doc_max_bytes = 65536
project_doc_fallback_filenames = ["TEAM_GUIDE.md"]

[sandbox_workspace_write]
writable_roots = ["/Users/me/shared"]
network_access = false

[shell_environment_policy]
inherit = "core"            # all | core | none

[features]
unified_exec = true         # `codex features` to list

[model_providers.proxy]
name = "LLM proxy"
base_url = "http://proxy.example.com"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

### 3.7 AGENTS.md discovery
1. **Global:** `$CODEX_HOME/AGENTS.override.md`, otherwise `AGENTS.md`.
2. **Project:** from the git root down to the current directory, at most one file per directory: `AGENTS.override.md` > `AGENTS.md` > names in `project_doc_fallback_filenames`.
3. **Merge order:** concatenated root to leaf; deeper files take precedence.
4. **Size cap:** `project_doc_max_bytes`, default 32 KiB.
5. **Freshness:** rebuilt every run. `/init` creates a starter file.
6. **Review rules:** a `## Code Review Rules` section in AGENTS.md customizes code reviews.

### 3.8 MCP
```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
enabled_tools = ["get_file"]
default_tools_approval_mode = "prompt"   # auto|prompt|writes|approve
startup_timeout_sec = 20
tool_timeout_sec = 45
```
- **CLI:** `codex mcp add <name> -- <cmd>` or `--url <url>`; `codex mcp list|remove|login|logout`; `/mcp` in the TUI.
- **Codex as an MCP server was removed on 2026-09-05.** Use the **app server** instead:
  - `codex app-server --listen stdio:// | ws://IP:PORT | unix://`
  - JSON-RPC 2.0. Methods include `thread/start|resume|fork`, `turn/start|steer|interrupt` and `command/exec`.
  - `codex app-server generate-ts --out ./schemas` generates types. The VS Code extension runs on it.

### 3.9 Slash commands and skills
- **Slash commands:**
  - Session: `/init`, `/status`, `/model`, `/reasoning`, `/permissions`, `/compact`, `/new`, `/rename`, `/archive`.
  - Planning and review: `/plan`, `/goal`, `/review`.
  - Where work runs: `/fork`, `/side`, `/worktree`, `/local`, `/cloud`, `/cloud-environment`.
  - Tools and settings: `/mcp`, `/memories`, `/fast`, `/ide-context`, `/hooks`, `/skills`, `/approve`, `/usage`, `/feedback`.
- **Skills:**
  - Format: a folder with `SKILL.md` (`name` and `description` required), plus optional `scripts/`, `references/`, `assets/` and `agents/openai.yaml`.
  - Locations: `.agents/skills` (repo, walking up to the root), `~/.agents/skills`, `/etc/codex/skills`, and bundled system skills.
  - Invoke with `$name` or `/skills`; Codex may also pick one implicitly. Disable via `[[skills.config]] enabled=false`.
- **Plugins:** `codex plugin`, `codex plugin marketplace`.
- **Custom prompts** (`~/.codex/prompts/*.md`, `/prompts:<name>`) are **deprecated** in favor of skills.

### 3.10 Non-interactive mode
```bash
codex exec "summarize repo"                    # final msg -> stdout, progress -> stderr; exec defaults read-only
codex exec --json "..." | jq                   # JSONL: thread.started, turn.*, item.*, error
codex exec "Extract" --output-schema schema.json -o out.json
codex exec --sandbox workspace-write "fix failing test"
npm test 2>&1 | codex exec "explain failures"
codex exec resume --last "now fix them"
CODEX_API_KEY=sk-... codex exec --json "triage"
```
- **Other `codex exec` flags:** `--ephemeral`, `--skip-git-repo-check`, `--ignore-user-config`, `--ignore-rules`.
- **Session commands:** `codex resume [--last|--all|id]`, `codex fork`, `codex archive|unarchive|delete`, `codex review`.

### 3.11 Cloud, code review and SDK
- **Cloud environments:**
  - Codex auto-detects setup and records an Install script and a Start skill.
  - Internet access: Package managers preset, custom domains only, or unrestricted.
  - Environment variables are passed to programs. Network secrets are swapped in by a proxy, and only for allowed HTTPS destinations.
- **Cloud tasks:** start from the web, desktop, iOS, IDE, `@codex`, or the CLI (`codex cloud`, `codex cloud exec --env <id> --attempts 1-4`, `codex apply <task-id>`). Tasks keep running while your computer sleeps; VM state is kept 7 days.
- **Code review:**
  - Local: `/review` or `codex review` against a base branch, uncommitted changes or a commit.
  - GitHub: `@codex review [focus]`, `@codex security review`, `@codex fix the P1 issue`. Automatic reviews post **P0/P1 only**.
- **SDK:**
  - TypeScript: `npm i @openai/codex-sdk`, then `new Codex().startThread().run("...")`; `resumeThread(id)` continues a thread.
  - Python: `pip install openai-codex`, then `Codex().thread_start(...).run(...)`; `AsyncCodex` is the async version.

### 3.12 Hooks and notify
- **Hooks are on by default** (turn off with `[features] hooks=false`).
  - Sources: `~/.codex/hooks.json` or `[[hooks.Event]]` in config.toml, plus `<repo>/.codex/` for trusted repos.
  - Non-managed hooks must be trusted with `/hooks` before they run.
  - **Events:** SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStart, SubagentStop, Stop, Interrupt.
  - **Exit 2 blocks.** Default timeout is 600 s.
```json
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"python3 ~/.codex/hooks/check.py","timeout":30}]}]}}
```
- **`notify`:** runs on `agent-turn-complete` and receives a JSON argument. Separate TUI alerts: `tui.notifications`, `tui.notification_method`.

### 3.13 Pricing
| Plan | Price | Codex access |
|---|---|---|
| Free | $0 | Quick tasks, GPT-6 Luna |
| Go | $8 | Same models as Free |
| Plus | $20 | Web, CLI, IDE, cloud review, Slack, 6.1 Sol |
| Pro | $100 / $200 / $500 | No 5-hour limit; Ultrafast on the $500 tier |
| Business | $20–25/user | Larger VMs, SSO |
| Enterprise / Edu | Contact sales | SCIM, EKM, RBAC |
| API key | API rates | No cloud features |

- **Usage limits (Plus, per 5 hours):** roughly Luna 350–3,000, 6.1 Sol 15–160, Astra 5–45 messages.
- **Fast and Ultrafast** consume 2.5× and 8× usage.

### 3.14 Best practices and gotchas
- **Prompting:** state the goal, context, constraints and the expected output. For bugs, have Codex reproduce before patching. Name specific files.
- **Planning:** use `/plan` and `/goal`, one milestone per task. Fan large work out to cloud tasks or worktrees.
- **Safety nets:** create git checkpoints, have Codex run lint and tests and report the commands it used, and review the diff yourself.
- **AGENTS.md:** keep it under 32 KiB with build and test commands.
- **Permissions:** start with workspace-write + on-request; use `--yolo` only in disposable containers.
- **Gotchas:**
  - An untrusted repo's `.codex/` config, hooks and rules are skipped silently.
  - API-key users get no cloud features.
  - Windows MXC kills detached processes.
  - Linux needs bubblewrap or user namespaces.

---

## 4. OpenCode

### 4.1 What it is and its history
- **Product:** a provider-agnostic AI coding agent under the MIT license, written in TypeScript on Bun. Repo: **github.com/anomalyco/opencode** (`sst/opencode` redirects there; about 213k stars). Website: opencode.ai.
- **Surfaces:** terminal UI, desktop app (beta), web UI, IDE extension, headless server, SDK, GitHub Action.
- **Latest:** **v1.19.0 (2026-10-11).** Adds `opencode upgrade --major` to move to **OpenCode 2** and **stops auto-updating**. OpenCode 2's changes are not yet documented **[unverified]**, and the curl script installs 1.x, which can conflict with a 2.x install.
- **History:** The original Go `opencode-ai/opencode` (Kujtim Hoxha) moved to Charm in mid-2025 and was renamed **Crush** (`charmbracelet/crush`). SST forked it and rewrote it in TypeScript under the OpenCode name. Old guides that mention Go, `.opencode.json` or Bubble Tea config refer to Crush.

### 4.2 Architecture
- **Client/server:** `opencode` starts a server on `127.0.0.1:4096` and a TUI client.
  - The OpenAPI 3.1 spec is at `/doc`.
  - Endpoints: `/session`, `/session/:id/message`, `/session/:id/prompt_async`, `/event` (SSE), `/file`, `/find`, `/config`, `/provider`, `/tui/*`.
- **Server modes:** `opencode serve` (headless), `web` (browser UI), `attach <url>`, `acp` (Agent Client Protocol over stdio). Basic auth via `OPENCODE_SERVER_PASSWORD`.
- **Desktop app:** macOS, Windows and Linux (`brew install --cask opencode-desktop`).
- **IDE extension** (VS Code, Cursor, Windsurf, VSCodium): installs itself when you run `opencode` in the integrated terminal.
  - Cmd/Ctrl+Esc opens it; Cmd/Ctrl+Shift+Esc starts a new session.
  - Cmd+Opt+K inserts a reference like `@File#L37-42`.
- **Storage:** `~/.local/share/opencode/` (`auth.json`, `mcp-auth.json`); npm plugin cache in `~/.cache/opencode/node_modules/`.

### 4.3 Install and auth
```bash
curl -fsSL https://opencode.ai/install | bash      # 1.x
npm i -g opencode-ai          # (bun/pnpm/yarn too)
brew install anomalyco/tap/opencode
paru -S opencode-bin | nix run nixpkgs#opencode | choco/scoop install opencode | docker run -it --rm ghcr.io/anomalyco/opencode
opencode upgrade [--major] ; opencode uninstall
opencode auth login [-p provider] ; opencode auth list ; opencode auth logout     # or /connect in TUI
opencode models --refresh --verbose
```
- **Providers:** 75+ through the Vercel AI SDK and the models.dev catalog; provider env vars such as `ANTHROPIC_API_KEY` also work.
- **Subscription logins:**
  - **ChatGPT Plus/Pro:** browser OAuth via `/connect`.
  - **GitHub Copilot:** device-code flow.
  - **Claude Pro/Max:** restricted. Anthropic prohibits third-party use, and the bundled plugins were removed in v1.3.0.
- **Local models:** use `@ai-sdk/openai-compatible`. Ollama is at `http://localhost:11434/v1`; raise `num_ctx` to 16k–32k if tool calls fail.

### 4.4 Configuration
- **Format:** `opencode.json` / `opencode.jsonc`, schema `https://opencode.ai/config.json`. Files are **merged**, not replaced.
- **Precedence, lowest to highest:**
  1. Remote `.well-known/opencode` (org defaults)
  2. Global `~/.config/opencode/opencode.json`
  3. `OPENCODE_CONFIG`
  4. Project `opencode.json` (found by walking up to the git root)
  5. `.opencode/` directories (`OPENCODE_CONFIG_DIR` adds one)
  6. `OPENCODE_CONFIG_CONTENT`
  7. Managed files: `/Library/Application Support/opencode/`, `/etc/opencode/`
  8. macOS MDM
- **TUI settings** (theme, keybinds, scroll, diff_style, mouse) moved to **`tui.json`** (schema `https://opencode.ai/tui.json`).
- **Variables:** `{env:VAR}`, `{file:path}`.
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "default_agent": "build",
  "autoupdate": "notify",
  "share": "manual",                       // manual | auto | disabled
  "instructions": ["CONTRIBUTING.md", ".cursor/rules/*.md"],
  "permission": { "edit": "ask", "bash": { "*": "ask", "git *": "allow" } },
  "formatter": true, "lsp": true,
  "mcp": {}, "plugin": ["@my-org/custom-plugin"],
  "provider": { "anthropic": { "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" } } },
  "compaction": { "auto": true, "reserved": 10000 },
  "server": { "port": 4096, "hostname": "127.0.0.1" },
  "snapshot": true
}
```

### 4.5 Agents
- **Primary agents** (switch with **Tab**):
  - **build:** the default, with all tools.
  - **plan:** edits and bash default to ask.
- **Subagents:**
  - **general:** full tools.
  - **explore:** fast, read-only search.
  - **scout:** external docs research (experimental).
  - Invoked via the `task` tool or an `@mention`. `<leader>Down` enters a child session.
- **Custom agents:** `.opencode/agents/<name>.md` or `~/.config/opencode/agents/`, or the `agent` key in config. The directories are now plural; singular `agent/` may still load **[unverified]**. Scaffold with `opencode agent create`.
```markdown
---
description: Reviews code for best practices      # required
mode: subagent          # primary | subagent | all
model: anthropic/claude-sonnet-4-5
temperature: 0.1
steps: 20               # replaces maxSteps
permission:
  edit: deny
  bash: { "*": "ask", "git diff*": "allow" }
---
You are a code reviewer. Focus on security, performance, maintainability.
```

### 4.6 Rules, commands and tools
- **Rules:**
  - `/init` writes `AGENTS.md`; commit it.
  - Lookup: local `AGENTS.md` (walking up), then `~/.config/opencode/AGENTS.md`, then **`CLAUDE.md`** and **`~/.claude/CLAUDE.md`** as fallbacks.
  - The `instructions` array adds files, globs or URLs.
  - Turn off the Claude fallbacks with `OPENCODE_DISABLE_CLAUDE_CODE(_PROMPT|_SKILLS)=1`.
- **Commands:**
  - Location: `.opencode/commands/<name>.md` or `~/.config/opencode/commands/`, run as `/name`.
  - Frontmatter: `description`, `agent`, `model`, `subtask`.
  - Placeholders: `$ARGUMENTS`, `$1`, `` !`cmd` ``, `@file`.
  - Built-ins: `/init`, `/undo`, `/redo`, `/share`, `/unshare`, `/connect`, `/models`, `/theme`, `/editor`, `/export`, `/update`.
```markdown
---
description: Run tests with coverage
agent: build
---
Run the full test suite with coverage. Recent changes: !`git diff --stat`
Focus on $ARGUMENTS
```
- **Tools:**
  - Built-in: bash, edit, write, read, grep, glob, apply_patch, lsp (experimental), skill, webfetch, websearch (needs `OPENCODE_ENABLE_EXA`), question.
  - Custom tools: `.opencode/tools/*.ts` using `tool({description, args, execute})` from `@opencode-ai/plugin`.

### 4.7 Permissions
- **Values:** `allow` | `ask` | `deny`.
- **Keys:** read, edit, glob, grep, bash, task, skill, lsp, question, webfetch, websearch, external_directory, doom_loop.
- **Matching:** **the last matching rule wins**, so put `"*"` first.
- **Defaults:** mostly allow; external_directory and doom_loop are ask; `*.env` reads are blocked.
- **Overrides:** `--auto` approves every ask (denies still apply). `OPENCODE_PERMISSION` takes inline JSON. Per-agent permissions override global ones.
```json
"permission": { "*": "ask",
  "bash": { "*": "ask", "git *": "allow", "rm *": "deny", "git push *": "deny" },
  "external_directory": { "~/projects/personal/**": "allow" } }
```

### 4.8 MCP, LSP and formatters
```jsonc
"mcp": {
  "local-thing": { "type": "local", "command": ["npx","-y","my-mcp-command"], "environment": {"KEY":"{env:KEY}"}, "enabled": true, "timeout": 5000 },
  "sentry": { "type": "remote", "url": "https://mcp.sentry.dev/mcp", "oauth": {} },
  "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY":"{env:CONTEXT7_API_KEY}"} } }
```
- **MCP:**
  - OAuth starts automatically on a 401, with dynamic client registration.
  - CLI: `opencode mcp add|list|auth|logout|debug`.
  - Tools are prefixed `<server>_`; gate them with `"tools": {"sentry_*": false}`.
- **LSP** feeds diagnostics to the agent; enable with `"lsp": true`. Built-ins include TypeScript, pyright, gopls, rust-analyzer and clangd.
- **Formatters** run after each edit; enable with `"formatter": true`. Built-ins include prettier, biome, gofmt, rustfmt, ruff and clang-format; add custom ones with `{command:["black","$FILE"], extensions:[".py"]}`.

### 4.9 Plugins
- **Locations:** `.opencode/plugins/` or `~/.config/opencode/plugins/`, or npm packages listed in `"plugin": []`. `--pure` turns external plugins off.
- **Shape:** a plugin is an async function receiving `{ project, directory, worktree, client, $ }` that returns hooks.
- **Events:**
  - Tools: `tool.execute.before/after`.
  - Sessions: `session.created|idle|compacted|error|diff|…`.
  - Messages: `message.updated`.
  - Files: `file.edited`.
  - Permissions: `permission.asked/replied`.
  - Other: `lsp.client.diagnostics`, `command.executed`, `shell.env`, `tui.toast.show`, `experimental.session.compacting`.
```ts
import type { Plugin } from "@opencode-ai/plugin"
export const EnvGuard: Plugin = async ({ $ }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "read" && output.args.filePath.includes(".env")) throw new Error("Do not read .env")
  },
  event: async ({ event }) => { if (event.type === "session.idle") await $`say done` },
})
```

### 4.10 TUI, CLI and SDK
- **Themes:** opencode, system, tokyonight, everforest, ayu, catppuccin, gruvbox, kanagawa, nord, matrix, one-dark. Custom themes go in `~/.config/opencode/themes/`.
- **Keybinds** (leader is **ctrl+x**):

| Action | Key |
|---|---|
| New session | `<leader>n` |
| Session list | `<leader>l` |
| Compact | `<leader>c` |
| Export | `<leader>x` |
| Models | `<leader>m` |
| Agents | `<leader>a` |
| Editor | `<leader>e` |
| Sidebar | `<leader>b` |
| Theme | `<leader>t` |
| Command palette | `ctrl+p` |
| Interrupt | `esc` |
| Cycle agent | `tab` |
| Quit | `<leader>q` |

- **CLI:**
  - TUI: `opencode [dir] -c -s <id> --fork -m provider/model --agent --auto`.
  - Non-interactive: `opencode run "msg" -f file --format json --attach http://host:4096`.
  - Servers: `serve`, `web`, `attach`, `acp`.
  - Agents and integrations: `agent create|list`, `github install|run`, `pr <n>`.
  - Sessions and data: `session list|delete`, `export --sanitize`, `import`, `stats`, `db path`.
  - Maintenance: `upgrade`, `uninstall`. Global flags: `--print-logs`, `--log-level`, `--pure`.
- **SDK** (`@opencode-ai/sdk`):
  - Start a server and client with `createOpencode({port})`, or attach with `createOpencodeClient({baseUrl})`.
  - APIs: `session.create/prompt/messages/abort`, `find.text/files/symbols`, `event.subscribe()`.
  - Structured output: `format: {type:"json_schema", schema}`.

### 4.11 Sharing, GitHub and pricing
- **Sharing:** `share` = manual | auto | disabled. `/share` creates a **public** `opncd.ai/s/<id>` link with the full history; `/unshare` deletes it. Use `disabled` on sensitive repos.
- **GitHub:** `opencode github install`, then comment `/opencode` or `/oc` on an issue or PR. The workflow uses `anomalyco/opencode/github@latest` with a required `model` input; `pull_request` triggers default to a review.
- **Pricing:**
  - **OpenCode itself:** free; bring your own keys.
  - **Zen** (being renamed "Console"): curated pay-as-you-go models (`opencode/<model>`). $20 top-ups, zero markup, spend limits.
  - **Go:** $10/mo, or $40 for Go Plus. Open, cheaper models with monthly, weekly and 5-hour caps.
  - Free models may train on your data.

### 4.12 Best practices and limitations
- **Commit the shared files:** `AGENTS.md` and the project `opencode.json`. Keep keys global.
- **Plan, then build:** Tab to Plan, refine, Tab back to Build. Use `/undo` and `/redo`, and keep snapshots on.
- **Permissions:** start with `"*": "ask"` plus allow-lists; deny `rm *` and `git push *`.
- **Enable LSP and formatters** for diagnostics and clean diffs.
- **Protect secrets:** set `share: "disabled"` on private repos and put secrets in `{env:...}`.
- **Automation:** use `opencode run --format json`, or the SDK against `opencode serve`.
- **Upgrade deliberately:** pin 1.x until you've reviewed OpenCode 2.
- **Limitations:**
  - Many config changes make old tutorials stale: plural directories, `tui.json`, `permission` instead of `tools`, `steps` instead of `maxSteps`.
  - Use WSL on Windows.
  - Local models need large context windows.
  - Experimental features sit behind `OPENCODE_EXPERIMENTAL_*` flags.

---

## 5. Portable setup across all four tools
1. **Instructions:** put shared repo instructions in **`AGENTS.md`**. Claude Code reads it when no CLAUDE.md exists; you can also add `@AGENTS.md` to CLAUDE.md. Cursor, Codex and OpenCode read it natively.
2. **Skills:** write skills once as `SKILL.md` folders. Cursor reads `.claude/skills`, `.codex/skills` and `.agents/skills`; Codex reads `.agents/skills`; OpenCode reads `.claude/skills`.
3. **MCP:** the same servers need four config formats:

| Tool | File | Key | Format |
|---|---|---|---|
| Cursor | `.cursor/mcp.json` | `mcpServers` | JSON |
| Claude Code | `.mcp.json` | `mcpServers` | JSON |
| Codex | `.codex/config.toml` | `[mcp_servers.x]` | TOML |
| OpenCode | `opencode.json` | `mcp` (`type: local/remote`, `command` as an array) | JSON |

4. **Secrets:** deny `.env` reads in each tool's permissions; all four support this. Cursor's `.cursorignore` does not stop the terminal or MCP tools.
5. **Headless/CI:**

| Tool | Command |
|---|---|
| Cursor | `agent -p --output-format json` |
| Claude Code | `claude -p --output-format json --bare` |
| Codex | `codex exec --json` |
| OpenCode | `opencode run --format json` |

---

## Sources
- **Cursor:** cursor.com/docs (rules, skills, mcp, hooks, cli, bugbot, cloud-agent, models-and-pricing, enterprise/privacy-and-data-governance), cursor.com/changelog, forum.cursor.com, news coverage of the SpaceX deal
- **Claude Code:** code.claude.com/docs/en/* (overview, setup, authentication, model-config, permission-modes, memory, settings, commands, skills, sub-agents, hooks, mcp, plugins, headless, cli-reference, checkpointing, worktrees, workflows, costs, changelog)
- **Codex:** github.com/openai/codex, developers.openai.com/codex/* (now redirects to learn.chatgpt.com/docs), npm @openai/codex
- **OpenCode:** opencode.ai/docs/*, github.com/anomalyco/opencode releases, opencode.ai/zen
