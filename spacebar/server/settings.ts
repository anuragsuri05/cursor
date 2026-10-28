import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SPACEBAR_HOME = process.env.SPACEBAR_HOME || path.join(os.homedir(), ".spacebar");
const SETTINGS_FILE = path.join(SPACEBAR_HOME, "settings.json");

export type RunMode = "ask" | "allowlist" | "auto";

export interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  baseURL?: string;
}

export interface Settings {
  providers: Record<string, ProviderSettings>;
  /** "auto" picks the best available model; otherwise "provider/model" or "ensemble/<id>". */
  defaultModel: string;
  /** Model used for Tab autocomplete. "auto" picks the fastest available. */
  tabModel: string;
  tabEnabled: boolean;
  /** Models hidden from the picker. */
  hiddenModels: string[];
  ensemble: {
    /** Pool of models used by ensembles. Empty = auto-pick the best free models. */
    pool: string[];
    /** Model that merges proposals (Council) and reviews diffs (Squad). Empty = auto. */
    judge: string;
    proposers: number;
    reviewRounds: number;
  };
  agent: {
    runMode: RunMode;
    allowlist: string[];
    denylist: string[];
    maxSteps: number;
  };
  userRules: string;
  lastWorkspace?: string;
  recentWorkspaces: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {},
  defaultModel: "auto",
  tabModel: "auto",
  tabEnabled: true,
  hiddenModels: [],
  ensemble: { pool: [], judge: "", proposers: 3, reviewRounds: 1 },
  agent: {
    runMode: "allowlist",
    allowlist: ["ls", "cat", "pwd", "git status", "git diff", "git log", "npm test", "npm run", "pnpm test", "yarn test", "pytest", "go test", "cargo test", "node --version", "rg", "grep", "find", "echo", "tsc"],
    denylist: ["rm -rf /", "sudo", "git push", "mkfs", "shutdown", ":(){"],
    maxSteps: 40,
  },
  userRules: "",
  recentWorkspaces: [],
};

let cache: Settings | null = null;

function merge<T>(base: T, over: any): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return (over ?? base) as T;
  const out: any = { ...base };
  for (const k of Object.keys(over ?? {})) {
    const b = (base as any)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, over[k]) : over[k];
  }
  return out;
}

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = merge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")));
  } catch {
    cache = structuredClone(DEFAULT_SETTINGS);
  }
  return cache!;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = merge(getSettings(), patch);
  fs.mkdirSync(SPACEBAR_HOME, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cache = next;
  return next;
}

/** Settings safe to send to the browser: API keys are masked. */
export function publicSettings(): any {
  const s = structuredClone(getSettings());
  for (const p of Object.values(s.providers)) {
    if (p.apiKey) p.apiKey = "••••" + p.apiKey.slice(-4);
  }
  return s;
}
