import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "../settings.js";

export type ProviderKind = "openai" | "anthropic" | "cli";
export type Tier = "free" | "local" | "premium" | "agent";

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  tier: Tier;
  baseURL?: string;
  envKey?: string;
  noKey?: boolean;
  signup?: string;
  note?: string;
  command?: string;
  /** Used when the provider's model list can't be fetched. */
  fallbackModels: string[];
  /** Return only models matching this filter after listing. */
  filter?: (m: any) => boolean;
  /** Works out of the box: no account, key or install needed (or the CLI is already installed). */
  zeroSetup?: boolean;
  /** A key is optional (raises limits). */
  keyOptional?: boolean;
}

const orFree = (m: any) =>
  String(m.id).endsWith(":free") || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);

export const PROVIDERS: ProviderDef[] = [
  // ---- Free, no setup ---------------------------------------------------
  {
    id: "opencode", name: "OpenCode Zen (free)", kind: "cli", tier: "free", command: "opencode", noKey: true, zeroSetup: true,
    signup: "https://opencode.ai/download",
    note: "Big Pickle, Nemotron, MiMo and more, free with no account. OpenCode only allows its free tier from inside OpenCode, so these run as the OpenCode agent (with OpenCode's default permissions). Some free models may use prompts for training.",
    fallbackModels: [],
  },
  {
    id: "llm7", name: "LLM7 (free)", kind: "openai", tier: "free", noKey: true, keyOptional: true, zeroSetup: true,
    baseURL: "https://api.llm7.io/v1", envKey: "LLM7_API_KEY", signup: "https://dash.llm7.io",
    note: "DeepSeek V4 Flash, GLM 5.3 Flash and Codestral with no key. Add a free token for higher limits (100k tokens/day).",
    fallbackModels: ["DeepSeek-V4-Flash-0731", "GLM-5.3-Flash", "codestral-latest"],
  },
  {
    id: "pollinations", name: "Pollinations (free)", kind: "openai", tier: "free", noKey: true, keyOptional: true, zeroSetup: true,
    baseURL: "https://text.pollinations.ai/openai", envKey: "POLLINATIONS_API_KEY", signup: "https://enter.pollinations.ai",
    note: "gpt-oss with no key (rate limited). Add a key to unlock more models.",
    fallbackModels: ["openai"],
  },
  // ---- Free cloud tiers -------------------------------------------------
  {
    id: "openrouter", name: "OpenRouter (free models)", kind: "openai", tier: "free",
    baseURL: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY",
    signup: "https://openrouter.ai/keys", note: "Dozens of free models (ids ending in :free): Qwen3 Coder, DeepSeek, Kimi, GLM, gpt-oss…",
    fallbackModels: ["qwen/qwen3-coder:free", "deepseek/deepseek-chat-v3.1:free", "moonshotai/kimi-k2:free", "z-ai/glm-4.5-air:free", "openai/gpt-oss-120b:free"],
    filter: orFree,
  },
  {
    id: "groq", name: "Groq", kind: "openai", tier: "free",
    baseURL: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY",
    signup: "https://console.groq.com/keys", note: "Free tier, extremely fast. Great for Tab and quick edits.",
    fallbackModels: ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b", "llama-3.3-70b-versatile"],
    filter: (m) => !/whisper|tts|guard|embed/i.test(m.id),
  },
  {
    id: "gemini", name: "Google Gemini", kind: "openai", tier: "free",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", envKey: "GEMINI_API_KEY",
    signup: "https://aistudio.google.com/apikey", note: "Free tier with large context windows.",
    fallbackModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    filter: (m) => /gemini/i.test(m.id) && !/embed|image|tts|audio|live/i.test(m.id),
  },
  {
    id: "cerebras", name: "Cerebras", kind: "openai", tier: "free",
    baseURL: "https://api.cerebras.ai/v1", envKey: "CEREBRAS_API_KEY",
    signup: "https://cloud.cerebras.ai", note: "Free tier, ~2000 tok/s.",
    fallbackModels: ["qwen-3-coder-480b", "gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507"],
  },
  {
    id: "mistral", name: "Mistral Codestral", kind: "openai", tier: "free",
    baseURL: "https://codestral.mistral.ai/v1", envKey: "CODESTRAL_API_KEY",
    signup: "https://console.mistral.ai/codestral", note: "Free Codestral key, with native fill-in-the-middle for Tab.",
    fallbackModels: ["codestral-latest"],
  },
  {
    id: "github", name: "GitHub Models", kind: "openai", tier: "free",
    baseURL: "https://models.github.ai/inference", envKey: "GITHUB_TOKEN",
    signup: "https://github.com/settings/tokens", note: "Free with any GitHub account (token with models:read).",
    fallbackModels: ["openai/gpt-4.1", "deepseek/DeepSeek-V3-0324", "meta/Llama-4-Maverick-17B-128E-Instruct-FP8"],
  },
  {
    id: "nvidia", name: "NVIDIA NIM", kind: "openai", tier: "free",
    baseURL: "https://integrate.api.nvidia.com/v1", envKey: "NVIDIA_API_KEY",
    signup: "https://build.nvidia.com", note: "Free credits for open models.",
    fallbackModels: ["qwen/qwen3-coder-480b-a35b-instruct", "deepseek-ai/deepseek-v3.1", "moonshotai/kimi-k2-instruct"],
    filter: (m) => /coder|deepseek|kimi|qwen3|glm|gpt-oss|llama-3\.3|nemotron/i.test(m.id) && !/embed|reward|guard|vision|vl/i.test(m.id),
  },
  // ---- Local ------------------------------------------------------------
  {
    id: "ollama", name: "Ollama (local)", kind: "openai", tier: "local",
    baseURL: "http://localhost:11434/v1", noKey: true,
    signup: "https://ollama.com", note: "Runs on your machine, 100% free and private.",
    fallbackModels: [],
    filter: (m) => !/embed/i.test(m.id),
  },
  {
    id: "lmstudio", name: "LM Studio (local)", kind: "openai", tier: "local",
    baseURL: "http://localhost:1234/v1", noKey: true,
    signup: "https://lmstudio.ai", note: "Local OpenAI-compatible server.",
    fallbackModels: [],
  },
  // ---- Premium ----------------------------------------------------------
  {
    id: "anthropic", name: "Anthropic (Claude)", kind: "anthropic", tier: "premium",
    envKey: "ANTHROPIC_API_KEY", signup: "https://console.anthropic.com",
    fallbackModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  },
  {
    id: "openai", name: "OpenAI (ChatGPT models)", kind: "openai", tier: "premium",
    baseURL: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY", signup: "https://platform.openai.com/api-keys",
    fallbackModels: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
    filter: (m) => /^(gpt|o\d|codex)/i.test(m.id) && !/audio|realtime|tts|transcribe|image|search|embedding/i.test(m.id),
  },
  {
    id: "deepseek", name: "DeepSeek", kind: "openai", tier: "premium",
    baseURL: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY", signup: "https://platform.deepseek.com",
    note: "Very cheap.", fallbackModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "xai", name: "xAI (Grok)", kind: "openai", tier: "premium",
    baseURL: "https://api.x.ai/v1", envKey: "XAI_API_KEY", signup: "https://console.x.ai",
    fallbackModels: ["grok-code-fast-1", "grok-4"],
  },
  {
    id: "custom", name: "Custom OpenAI-compatible", kind: "openai", tier: "premium",
    baseURL: "", envKey: "CUSTOM_API_KEY", note: "Any OpenAI-compatible endpoint (vLLM, Together, Fireworks, LiteLLM…).",
    fallbackModels: [],
  },
  // ---- Coding agents (use your own subscription via their CLI) ----------
  {
    id: "claude-code", name: "Claude Code", kind: "cli", tier: "agent", command: "claude", noKey: true,
    signup: "https://code.claude.com", note: "Runs the Claude Code CLI with your Claude subscription.",
    fallbackModels: ["default", "opus", "sonnet", "haiku"],
  },
  {
    id: "codex", name: "OpenAI Codex", kind: "cli", tier: "agent", command: "codex", noKey: true,
    signup: "https://developers.openai.com/codex", note: "Runs the Codex CLI with your ChatGPT plan.",
    fallbackModels: ["default"],
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

export function splitModel(full: string): { provider: string; model: string } {
  const i = full.indexOf("/");
  return i < 0 ? { provider: full, model: "" } : { provider: full.slice(0, i), model: full.slice(i + 1) };
}

export function providerKey(p: ProviderDef): string | undefined {
  const s = getSettings().providers[p.id];
  return s?.apiKey || (p.envKey ? process.env[p.envKey] : undefined);
}

export function providerBaseURL(p: ProviderDef): string {
  // Pollinations: the keyless endpoint is legacy; keyed requests use the current API.
  if (p.id === "pollinations" && getSettings().providers[p.id]?.apiKey) return "https://gen.pollinations.ai/v1";
  return getSettings().providers[p.id]?.baseURL || p.baseURL || "";
}

const cliCache = new Map<string, { at: number; path: string | null }>();
const CLI_FALLBACK_PATHS: Record<string, string[]> = {
  opencode: [`${os.homedir()}/.opencode/bin/opencode`],
  claude: [`${os.homedir()}/.local/bin/claude`, `${os.homedir()}/.claude/local/claude`],
};
/** Absolute path of an installed CLI, or null. Re-checked every 30s so fresh installs show up. */
export function cliPath(cmd: string): string | null {
  const c = cliCache.get(cmd);
  if (c && Date.now() - c.at < 30_000) return c.path;
  let found: string | null = null;
  try { found = execFileSync("which", [cmd], { encoding: "utf8" }).trim() || null; } catch { /* not on PATH */ }
  if (!found) found = (CLI_FALLBACK_PATHS[cmd] ?? []).find((p) => fs.existsSync(p)) ?? null;
  cliCache.set(cmd, { at: Date.now(), path: found });
  return found;
}
export const cliInstalled = (cmd: string) => !!cliPath(cmd);

/** A provider is usable when it is configured (key present / local server / CLI installed) and not disabled. */
export function providerConfigured(p: ProviderDef): boolean {
  const s = getSettings().providers[p.id];
  if (s && s.enabled === false) return false;
  if (p.kind === "cli") return cliInstalled(p.command!);
  if (p.id === "custom") return !!providerBaseURL(p);
  if (p.noKey) return true;
  return !!providerKey(p);
}

export interface ModelInfo {
  id: string; // provider/model
  provider: string;
  providerName: string;
  name: string;
  tier: Tier;
  kind: ProviderKind;
  zeroSetup: boolean;
  score: number; // heuristic coding strength
  speed: number; // heuristic speed
}

/** Heuristic ranking of open/free models for coding. Higher is better. */
export function codingScore(id: string): number {
  const s = id.toLowerCase();
  let score = 0;
  const bump: [RegExp, number][] = [
    [/claude|opus|fable/, 10], [/gpt-6|gpt-5/, 9], [/sonnet/, 9],
    [/qwen3?[-.]?coder.*480|qwen3-coder(?!.*(30b|flash))/, 8], [/kimi[- ]?k2|kimi-k3/, 8], [/deepseek.*(v3|r1|chat|reasoner|v4)/, 7.5],
    [/glm[- ]?(4\.[5-9]|5)/, 7.5], [/gemini.*pro/, 8], [/gpt-oss[-:]120b/, 7], [/minimax-m2/, 7], [/grok/, 7.5], [/codestral|devstral/, 6],
    [/qwen3.*235b/, 7], [/gemini.*flash/, 6.5], [/llama-?4|maverick/, 6], [/qwen3/, 5.5], [/llama-?3\.3.*70b/, 5],
    [/gpt-oss[-:]20b|openai-fast/, 5], [/big-pickle/, 7.5], [/nemotron-3-ultra/, 7], [/space-bunny|muse-spark|longcat|mimo/, 6.5],
    [/ling-|nemotron.*lightning|cat-jam/, 5.5], [/qwen2\.5.*coder/, 5], [/haiku/, 6], [/deepseek-r1/, 5], [/qwen2\.5/, 3.5], [/gemma/, 3.5],
  ];
  for (const [re, v] of bump) if (re.test(s)) { score = Math.max(score, v); }
  if (score > 6 && /flash|lite|mini|nano/.test(s) && !/gemini/.test(s)) score -= 0.7;
  if (/coder|code/.test(s)) score += 0.5;
  if (!score) score = 3;
  // Small distilled/local variants are far weaker than their flagship namesakes.
  const size = s.match(/[:\-_ ](\d+(?:\.\d+)?)b\b/);
  if (size && Number(size[1]) < 30) score = Math.min(score, 3 + Number(size[1]) / 8);
  if (/uncensored|vicuna|wizard/.test(s)) score = Math.min(score, 2);
  return score;
}

export function speedScore(provider: string, id: string): number {
  let s = ({ groq: 9, cerebras: 10, mistral: 7, gemini: 6, ollama: 5, lmstudio: 5, llm7: 6, pollinations: 4, opencode: 3 } as Record<string, number>)[provider] ?? 4;
  if (/flash|mini|haiku|fast|20b|8b|7b|instant|luna/i.test(id)) s += 1.5;
  if (/480b|opus|astra|pro|reason|r1/i.test(id)) s -= 1;
  return s;
}

const listCache = new Map<string, { at: number; models: string[] }>();

async function fetchModelIds(p: ProviderDef): Promise<string[]> {
  if (p.id === "opencode") {
    // `opencode models opencode` lists only models usable without an account (the free ones).
    const { stdout } = await promisify(execFile)(cliPath("opencode")!, ["models", "opencode"], { timeout: 20_000 });
    const ids = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("opencode/")).map((l) => l.slice(9));
    return ids.length ? ids : p.fallbackModels;
  }
  if (p.kind === "cli") return p.fallbackModels;
  if (p.id === "llm7") {
    const res = await fetch(`${providerBaseURL(p)}/models`, { headers: providerKey(p) ? { Authorization: `Bearer ${providerKey(p)}` } : {}, signal: AbortSignal.timeout(8000) });
    const list: any[] = (await res.json()).data ?? [];
    // Without a token only the "turbo" tier is served.
    return list.filter((m) => m.model_type === "chat" && (providerKey(p) || m.tier === "turbo")).map((m) => m.id);
  }
  if (p.id === "pollinations" && !providerKey(p)) {
    const res = await fetch("https://text.pollinations.ai/models", { signal: AbortSignal.timeout(8000) });
    const list: any[] = await res.json();
    return list.filter((m) => m.tier === "anonymous" && m.output_modalities?.includes("text")).map((m) => m.aliases?.includes("openai") ? "openai" : m.name);
  }
  if (p.kind === "anthropic") {
    const client = new Anthropic({ apiKey: providerKey(p) });
    const out: string[] = [];
    for await (const m of client.models.list()) out.push(m.id);
    return out.length ? out : p.fallbackModels;
  }
  const base = providerBaseURL(p);
  const key = providerKey(p);
  const url = p.id === "github" ? "https://models.github.ai/catalog/models" : `${base}/models`;
  const res = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(p.tier === "local" ? 1500 : 8000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json: any = await res.json();
  let list: any[] = Array.isArray(json) ? json : json.data ?? json.models ?? [];
  if (p.filter) list = list.filter(p.filter);
  return list.map((m) => String(m.id ?? m.name).replace(/^models\//, ""));
}

export async function listModels(force = false): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  await Promise.all(
    PROVIDERS.filter(providerConfigured).map(async (p) => {
      let ids: string[];
      const c = listCache.get(p.id);
      if (!force && c && Date.now() - c.at < 10 * 60_000) ids = c.models;
      else {
        try { ids = await fetchModelIds(p); } catch { ids = p.tier === "local" ? [] : p.fallbackModels; }
        listCache.set(p.id, { at: Date.now(), models: ids });
      }
      for (const m of ids) {
        out.push({
          id: `${p.id}/${m}`, provider: p.id, providerName: p.name,
          name: prettyName(p.id, m), tier: p.tier, kind: p.kind, zeroSetup: !!p.zeroSetup,
          score: codingScore(`${m} ${prettyName(p.id, m)}`), speed: speedScore(p.id, m),
        });
      }
    }),
  );
  return out.sort((a, b) => b.score - a.score || b.speed - a.speed);
}

/** Models that can run the built-in agent loop (everything except CLI agents). */
export async function apiModels(): Promise<ModelInfo[]> {
  const hidden = new Set(getSettings().hiddenModels);
  return (await listModels()).filter((m) => m.kind !== "cli" && !hidden.has(m.id));
}

/** Pick the best model for a purpose. Free models are preferred when `preferFree`. */
// ---------------------------------------------------------------------------
// Rate-limit memory: free tiers run out; skip exhausted models/providers until they reset.

const cooldowns = new Map<string, number>(); // key: "provider" or "provider/model" -> until (ms)

export function noteRateLimit(model: string, message: string) {
  const { provider } = splitModel(model);
  const secs = Number(message.match(/retry after (\d+)/i)?.[1] ?? message.match(/try again in (\d+)/i)?.[1] ?? 0);
  // Daily/global quotas apply to the whole provider (keyless quotas are per IP).
  const whole = /daily|quota|per day|insufficient_quota/i.test(message);
  const until = Date.now() + Math.min(Math.max(secs || 60, 30), 24 * 3600) * 1000;
  cooldowns.set(whole ? provider : model, until);
}

export function coolingDown(model: string): boolean {
  const now = Date.now();
  const { provider } = splitModel(model);
  return (cooldowns.get(model) ?? 0) > now || (cooldowns.get(provider) ?? 0) > now;
}

export async function pickModels(
  n: number,
  opts: { preferFree?: boolean; fast?: boolean; exclude?: string[]; includeAgents?: boolean } = {},
): Promise<string[]> {
  const hidden = new Set(getSettings().hiddenModels);
  // OpenCode's free models can join ensembles (they run as OpenCode's own read-only plan agent);
  // subscription agents (Claude Code, Codex) are never picked automatically.
  const pool = opts.includeAgents
    ? (await listModels()).filter((m) => !hidden.has(m.id) && (m.kind !== "cli" || m.provider === "opencode"))
    : await apiModels();
  const models = pool.filter((m) => !opts.exclude?.includes(m.id) && !coolingDown(m.id));
  const rank = (m: ModelInfo) => {
    let r = opts.fast ? m.speed * 2 + m.score : m.score * 2 + m.speed * 0.3;
    if (opts.preferFree && (m.tier === "free" || m.tier === "local")) r += 100;
    if (m.tier === "local") r -= 3; // local models are usually smaller
    if (m.kind === "cli") r -= 1.5; // slower (a full agent run per call)
    return r;
  };
  const sorted = [...models].sort((a, b) => rank(b) - rank(a));
  // Diversity: distinct providers and model families first, so one exhausted quota can't take out the whole pool.
  const picked: ModelInfo[] = [];
  const family = (m: ModelInfo) => m.name.toLowerCase().replace(/^.*\//, "").split(/[-:._ ]/)[0];
  for (const m of sorted) {
    if (picked.length >= n) break;
    if (!picked.some((p) => p.provider === m.provider || family(p) === family(m))) picked.push(m);
  }
  for (const m of sorted) {
    if (picked.length >= n) break;
    if (!picked.some((p) => family(p) === family(m))) picked.push(m);
  }
  for (const m of sorted) {
    if (picked.length >= n) break;
    if (!picked.includes(m)) picked.push(m);
  }
  return picked.map((m) => m.id);
}

function prettyName(provider: string, id: string): string {
  if (provider === "pollinations" && id === "openai") return "gpt-oss-20b";
  if (provider === "opencode") return id.replace(/-free$/, "").split("-").map((w) => (/^\d|^v\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
  return id.replace(/:free$/, "");
}
