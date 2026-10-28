import { useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Types shared across the UI

export type Mode = "agent" | "ask" | "plan";

export interface TreeNode { name: string; path: string; type: "file" | "dir" }

export interface Tab {
  path: string; // file path, or "diff:<path>" for review tabs
  kind: "file" | "diff" | "settings";
  title: string;
  preview?: boolean;
  diff?: { file: string; original: string; modified?: string; sessionId?: string; source: "agent" | "git" | "apply" };
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; startedAt: number; endedAt?: number }
  | { type: "tool"; id: string; name: string; args: any; status: string; output?: string; meta?: any }
  | { type: "notice"; text: string }
  | { type: "approval"; id: string; command: string; status: "pending" | "approved" | "skipped" }
  | {
      type: "stage"; id: string; label: string; status: string; model?: string; models?: string[]; verdict?: string; detail?: string;
      parts: Part[]; proposals?: { id: string; model: string; text: string; status: string }[];
    };

export interface ContextChip { kind: "file" | "selection" | "image" | "terminal"; label: string; path?: string; content?: string; startLine?: number; endLine?: number; dataUrl?: string }

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  chips?: ContextChip[];
  mode?: Mode;
  parts?: Part[];
  model?: string;
  error?: string;
  stopped?: boolean;
}

export interface FileChange { path: string; added: number; removed: number; status: "added" | "modified" | "deleted" }

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  running: boolean;
  changes: FileChange[];
}

export interface ModelInfo { id: string; provider: string; providerName: string; name: string; tier: "free" | "local" | "premium" | "agent"; kind: "openai" | "anthropic" | "cli"; zeroSetup: boolean; score: number; speed: number }

export interface State {
  connected: boolean;
  workspace: { root: string; name: string; recent: string[] } | null;
  tree: Record<string, TreeNode[]>;
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  files: string[];

  tabs: Tab[];
  activeTab: string | null;
  dirty: Record<string, boolean>;
  cursor: { line: number; col: number; language: string; selection: number };
  markers: { errors: number; warnings: number };

  sidebarVisible: boolean;
  sidebarView: "explorer" | "search" | "scm";
  sidebarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  panelView: "terminal" | "problems" | "output";
  agentVisible: boolean;
  agentWidth: number;
  agentMaximized: boolean;

  settings: any;
  providers: any[];
  models: ModelInfo[];

  chats: Chat[];
  openChats: string[];
  activeChat: string;
  composerMode: Mode;
  composerModel: string;

  palette: null | "commands" | "files";
  settingsOpen: boolean;
  settingsSection: string;
  folderPickerOpen: boolean;
  git: { repo: boolean; branch: string; files: { status: string; path: string }[] };
  toasts: { id: number; text: string; kind?: "error" | "info" }[];
  focusComposer: number;
}

const ls = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };

export const newChat = (): Chat => ({ id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, title: "New Chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [], running: false, changes: [] });

const savedChats: Chat[] = ls("spacebar.chats", []).map((c: Chat) => ({ ...c, running: false }));
const firstChat = savedChats[0] ?? newChat();
const layout = ls("spacebar.layout", {} as any);

let state: State = {
  connected: false,
  workspace: null,
  tree: {},
  expanded: {},
  selectedPath: null,
  files: [],
  tabs: [],
  activeTab: null,
  dirty: {},
  cursor: { line: 1, col: 1, language: "", selection: 0 },
  markers: { errors: 0, warnings: 0 },
  sidebarVisible: layout.sidebarVisible ?? true,
  sidebarView: "explorer",
  sidebarWidth: layout.sidebarWidth ?? 260,
  panelVisible: layout.panelVisible ?? false,
  panelHeight: layout.panelHeight ?? 260,
  panelView: "terminal",
  agentVisible: layout.agentVisible ?? true,
  agentWidth: layout.agentWidth ?? 420,
  agentMaximized: false,
  settings: null,
  providers: [],
  models: [],
  chats: savedChats.length ? savedChats : [firstChat],
  openChats: ls("spacebar.openChats", [firstChat.id]),
  activeChat: ls("spacebar.activeChat", firstChat.id),
  composerMode: ls("spacebar.mode", "agent"),
  composerModel: ls("spacebar.model", "auto"),
  palette: null,
  settingsOpen: false,
  settingsSection: "models",
  folderPickerOpen: false,
  git: { repo: false, branch: "", files: [] },
  toasts: [],
  focusComposer: 0,
};
if (!state.chats.some((c) => c.id === state.activeChat)) state.activeChat = state.chats[0].id;
state.openChats = state.openChats.filter((id) => state.chats.some((c) => c.id === id));
if (!state.openChats.length) state.openChats = [state.activeChat];

const listeners = new Set<() => void>();
let persistTimer: any;

export function getState() { return state; }

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 400);
}

function persist() {
  try {
    localStorage.setItem("spacebar.chats", JSON.stringify(state.chats.slice(0, 100)));
    localStorage.setItem("spacebar.openChats", JSON.stringify(state.openChats));
    localStorage.setItem("spacebar.activeChat", JSON.stringify(state.activeChat));
    localStorage.setItem("spacebar.mode", JSON.stringify(state.composerMode));
    localStorage.setItem("spacebar.model", JSON.stringify(state.composerModel));
    localStorage.setItem("spacebar.layout", JSON.stringify({
      sidebarVisible: state.sidebarVisible, sidebarWidth: state.sidebarWidth, panelVisible: state.panelVisible,
      panelHeight: state.panelHeight, agentVisible: state.agentVisible, agentWidth: state.agentWidth,
    }));
  } catch { /* storage full or blocked */ }
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Selector hook. Results are memoized per state snapshot so selectors may build new arrays/objects safely. */
export function useStore<T>(sel: (s: State) => T): T {
  const cache = useRef<{ state: State | null; value: T }>({ state: null, value: undefined as T });
  return useSyncExternalStore(subscribe, () => {
    const c = cache.current;
    if (c.state !== state) {
      const next = sel(state);
      if (c.state === null || !shallowEqual(c.value, next)) c.value = next;
      c.state = state;
    }
    return c.value;
  });
}

function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return false;
}

export function updateChat(id: string, fn: (c: Chat) => Partial<Chat>) {
  setState((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, ...fn(c), updatedAt: Date.now() } : c)) }));
}

let toastId = 0;
export function toast(text: string, kind: "error" | "info" = "info") {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3000);
}

export const isMac = navigator.platform.toLowerCase().includes("mac");
export const MOD = isMac ? "⌘" : "Ctrl+";
export const basename = (p: string) => p.split("/").pop() || p;
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
