# Spacebar

Spacebar is an AI code editor that copies Cursor's layout and workflow. It is built to run on **free models**, and it can combine several of them into **ensembles** to get better results than any single one. You can also plug in Claude, GPT, Claude Code or Codex.

## Quick start

```bash
npm install
npm run dev            # opens http://localhost:5317 (API on :4317)
# or
npm start              # production build served at http://127.0.0.1:4317
npm run desktop        # same, in a native Electron window (downloads Electron on first run)
```

You can pass a folder to open: `npx tsx server/index.ts ~/code/my-project`. You can also use **Open Folder** (⌘O) inside the app.

**Free models work immediately — no account, no key.** Open the app and start chatting on **Auto**:

| Free, no setup | Models | How |
|---|---|---|
| OpenCode Zen | Big Pickle, Nemotron 3 Ultra, MiMo, Longcat, Space Bunny, Muse Spark, Ling… | Runs OpenCode's own agent (OpenCode only allows its free tier from inside OpenCode). Needs the OpenCode CLI — one click in Settings, or `curl -fsSL https://opencode.ai/install \| bash` |
| LLM7 | DeepSeek V4 Flash, GLM 5.3 Flash, MiniMax M2.7, Codestral, gpt-oss… | Keyless API (daily quota per IP; add a free token at dash.llm7.io for 100k tokens/day) |
| Pollinations | gpt-oss-20b | Keyless API (rate limited; add a key for more models) |
| Ollama / LM Studio | anything you have pulled | Local |

When a free quota runs out, Spacebar remembers it, skips that provider until it resets, and moves on to the next free model; if every keyless API is exhausted, it hands the task to an OpenCode free model. Free models may log prompts or use them for training.

For more models and higher limits, open **Settings → Models** (⇧⌘J) and add any free key below.

| More free providers | Get a key | Good for |
|---|---|---|
| OpenRouter | https://openrouter.ai/keys | Many `:free` models: Qwen3 Coder, DeepSeek, Kimi K2, GLM, gpt-oss |
| Groq | https://console.groq.com/keys | Very fast responses; Tab and quick edits |
| Google Gemini | https://aistudio.google.com/apikey | Long context |
| Cerebras | https://cloud.cerebras.ai | About 2000 tokens/s (Qwen3 Coder 480B) |
| Mistral Codestral | https://console.mistral.ai/codestral | Native fill-in-the-middle for Tab |
| GitHub Models | https://github.com/settings/tokens | Free with any GitHub account |
| NVIDIA NIM | https://build.nvidia.com | Free credits for open models |
| Ollama / LM Studio | https://ollama.com | Fully local and private, no key |

Keys can also come from environment variables: `LLM7_API_KEY`, `POLLINATIONS_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `CODESTRAL_API_KEY`, `GITHUB_TOKEN`, `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`.

Settings and keys are stored in `~/.spacebar/settings.json` with file mode 600. The server listens only on `127.0.0.1`.

## How the ensembles work

Pick **Ensemble Max** or **Ensemble Fast** in the model picker.

```
Ensemble Max
  1. Scout       a fast model explores the repo with read-only tools and collects context
  2. Proposers   N different free models draft an answer or plan, in parallel
  3. Synthesize  the strongest model checks the drafts against the code and writes the best one
  4. Execute     (Agent mode) a tool-using model implements the plan; if it is rate-limited,
                 Spacebar switches to the next provider automatically
  5. Review      a *different* model reviews the diff; the executor fixes real issues (N rounds)

Ensemble Fast:  Execute → Review
```

What each mode does with an ensemble:
- **Ask:** produces a synthesized answer.
- **Plan:** produces a synthesized plan, with a **Build** button to implement it.
- **Agent:** runs the full pipeline.

You can set the number of proposers, the review rounds, the judge model and the model pool in **Settings → Ensembles**.

Even when you pick a single model, Spacebar adds **automatic failover**. If that model returns 429 or 5xx, the request moves to the next-best free model, so free-tier rate limits don't stop your work.

## Features (Cursor parity)

| Cursor | Spacebar |
|---|---|
| Agent / Plan / Ask modes (⇧Tab to switch) | ✓ (Plan adds a **Build** button) |
| Agent tools: read, grep, find, edit, write, delete, terminal | ✓ (read-only tools run in parallel) |
| Command approval (Run / Skip / allowlist) | ✓ Ask / allowlist / run everything, plus a denylist |
| Keep / Undo per file, Review diff | ✓ Changes bar with an inline diff review |
| Tab autocomplete (ghost text) | ✓ Codestral FIM, or the fastest free model |
| ⌘K inline edit with red/green diff, Accept ⌘⏎ / Reject ⌘⌫, follow-ups | ✓ |
| ⌘L add selection to chat, @-mention files, paste images | ✓ |
| Apply a code block from chat to a file | ✓ A model merges the snippet, then you review the diff |
| Chat tabs, history, export | ✓ |
| Rules: `AGENTS.md`, `.cursor/rules/*.mdc`, `.cursorrules`, user rules | ✓ Also reads `CLAUDE.md` and `.spacebar/rules/*.md` |
| Explorer, Search (ripgrep), Source Control with AI commit messages | ✓ |
| Integrated terminal (real PTY) | ✓ |
| Command palette ⇧⌘P, Go to File ⌘P (`file:line`) | ✓ |
| Claude Code / Codex inside the editor | ✓ Runs the CLIs with your own subscriptions |

### Keyboard shortcuts

| Key | Action |
|---|---|
| ⌘I / ⌘L | Open or toggle the Agent (⌘L with a selection adds it to chat) |
| ⌘K | Inline edit |
| ⌘P / ⇧⌘P | Go to file / commands |
| ⌘B / ⌘J / ⌘\` | Toggle sidebar / panel / terminal |
| ⌘E | Maximize chat |
| ⌘N | New chat (in the Agent panel) |
| ⇧Tab / ⌘. | Switch mode / open the mode menu |
| ⇧⌘E / ⇧⌘F / ⌃⇧G | Explorer / Search / Source Control |
| ⌘S / ⌥⌘S | Save / save all |
| ⇧⌘J or ⌘, | Settings |

## Architecture

```
server/                  Node + Express + WebSocket (tsx, no build step)
  llm/providers.ts       Provider catalog, model discovery (/models), ranking, auto-pick
  llm/chat.ts            Streaming chat with tool calls for OpenAI-compatible APIs and the
                         Anthropic SDK; text tool protocol for models without native tools;
                         <think> parsing; failover
  agent/session.ts       Agent loop, ensembles, change tracking (Keep/Undo), Claude Code
                         and Codex bridges
  agent/tools.ts         Workspace tools; edit matching that tolerates model mistakes; command policy
  agent/prompts.ts       System prompt with rules, git state and file tree
  complete.ts            Tab completion, ⌘K inline edit, Apply, commit messages
  workspace.ts           Safe file system access (paths are confined to the workspace), ripgrep, git, rules
  terminal.ts            node-pty terminals
src/                     React + Monaco + xterm.js UI
electron/main.cjs        Optional desktop shell
```

## Notes and limits

- **Model ids:** Free model lists change often. Spacebar reads each provider's live `/models` endpoint and falls back to a built-in list only if that fails.
- **Local models:** Small models (≤8B) can chat and autocomplete, but they are unreliable at multi-step tool use. Use ensembles over free cloud models for real agent work.
- **OpenCode bridge:** Runs `opencode run --format json --agent build|plan` with OpenCode's stock settings (changing its config or prompt disables the free tier), so its default permissions apply. In ensembles, OpenCode models draft and review through the read-only plan agent, and implement through the build agent when no API model is available. Edits are tracked with a workspace snapshot, so Keep/Undo works.
- **Claude Code bridge:** Runs `claude -p --output-format stream-json`. Edits are allowed with `acceptEdits`, or with `bypassPermissions` when the agent run mode is "Run everything".
- **Codex bridge:** Runs `codex exec --json` with the `workspace-write` sandbox.
- **Not implemented yet:** MCP servers, cloud/background agents, semantic indexing (Spacebar uses ripgrep and the file tree, like Cursor's current approach), and multi-root workspaces.
