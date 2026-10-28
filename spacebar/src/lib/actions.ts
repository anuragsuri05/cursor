import * as monaco from "monaco-editor";
import { api, socket } from "./api";
import { basename, getState, newChat, setState, toast, updateChat, type Chat, type ContextChip, type Mode, type Part, type Tab, type UIMessage } from "./store";

// ---------------------------------------------------------------------------
// Workspace & explorer

export async function loadWorkspace() {
  const ws = await api.get("/api/workspace");
  setState({ workspace: ws.root ? ws : null, folderPickerOpen: false });
  if (ws.root) {
    await refreshDir(".");
    refreshFiles();
    refreshGit();
  } else setState({ workspace: null, tree: {} });
}

export async function openFolder(path: string) {
  try {
    await api.post("/api/workspace/open", { path });
    // Close tabs from the previous workspace.
    for (const m of monaco.editor.getModels()) m.dispose();
    setState({ tabs: [], activeTab: null, tree: {}, expanded: {}, dirty: {} });
    await loadWorkspace();
  } catch (e: any) { toast(e.message, "error"); }
}

export async function refreshDir(path: string) {
  try {
    const items = await api.get(`/api/fs/list?${api.q({ path })}`);
    setState((s) => ({ tree: { ...s.tree, [path]: items } }));
  } catch { /* dir removed */ setState((s) => { const t = { ...s.tree }; delete t[path]; return { tree: t }; }); }
}

let filesTimer: any;
export function refreshFiles() {
  clearTimeout(filesTimer);
  filesTimer = setTimeout(async () => setState({ files: await api.get("/api/fs/files").catch(() => []) }), 200);
}

export async function refreshGit() {
  setState({ git: await api.get("/api/git/status").catch(() => ({ repo: false, branch: "", files: [] })) });
}

export function toggleDir(path: string) {
  const open = !getState().expanded[path];
  setState((s) => ({ expanded: { ...s.expanded, [path]: open }, selectedPath: path }));
  if (open && !getState().tree[path]) refreshDir(path);
}

export async function revealInExplorer(path: string) {
  const parts = path.split("/");
  const expanded = { ...getState().expanded };
  for (let i = 1; i < parts.length; i++) {
    const d = parts.slice(0, i).join("/");
    expanded[d] = true;
    if (!getState().tree[d]) await refreshDir(d);
  }
  setState({ expanded, selectedPath: path });
}

// ---------------------------------------------------------------------------
// Editor models & tabs

export const uriFor = (path: string) => monaco.Uri.file("/" + path);
export const modelFor = (path: string) => monaco.editor.getModel(uriFor(path));
const savedVersion = new Map<string, number>();

export async function ensureModel(path: string): Promise<monaco.editor.ITextModel | null> {
  let model = modelFor(path);
  if (model) return model;
  const r = await api.get(`/api/fs/read?${api.q({ path })}`);
  if (r.binary || r.tooLarge) { toast(`${basename(path)} is ${r.binary ? "a binary file" : "too large"} and can't be opened`, "error"); return null; }
  model = modelFor(path) ?? monaco.editor.createModel(r.content, undefined, uriFor(path));
  savedVersion.set(path, model.getAlternativeVersionId());
  model.onDidChangeContent(() => {
    const dirty = model!.getAlternativeVersionId() !== savedVersion.get(path);
    if (getState().dirty[path] !== dirty) setState((s) => ({ dirty: { ...s.dirty, [path]: dirty } }));
  });
  return model;
}

export async function openFile(path: string, opts: { preview?: boolean; line?: number; col?: number; endLine?: number } = {}) {
  const model = await ensureModel(path);
  if (!model) return;
  setState((s) => {
    let tabs = s.tabs;
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      if (!opts.preview && existing.preview) tabs = tabs.map((t) => (t.path === path ? { ...t, preview: false } : t));
    } else {
      const tab: Tab = { path, kind: "file", title: basename(path), preview: opts.preview };
      const previewIdx = tabs.findIndex((t) => t.preview && !s.dirty[t.path]);
      const activeIdx = tabs.findIndex((t) => t.path === s.activeTab);
      if (opts.preview && previewIdx >= 0) tabs = tabs.map((t, i) => (i === previewIdx ? tab : t));
      else tabs = [...tabs.slice(0, activeIdx + 1), tab, ...tabs.slice(activeIdx + 1)];
    }
    return { tabs, activeTab: path, selectedPath: path };
  });
  if (opts.line) pendingReveal = { path, line: opts.line, col: opts.col ?? 1, endLine: opts.endLine };
  revealPending();
}

let pendingReveal: { path: string; line: number; col: number; endLine?: number } | null = null;
export let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null;
export function setActiveEditor(e: monaco.editor.IStandaloneCodeEditor | null) { activeEditor = e; revealPending(); }
function revealPending() {
  const r = pendingReveal;
  if (!r || !activeEditor || activeEditor.getModel()?.uri.toString() !== uriFor(r.path).toString()) return;
  pendingReveal = null;
  activeEditor.revealLineInCenter(r.line);
  activeEditor.setSelection(new monaco.Selection(r.line, r.col, r.endLine ?? r.line, r.endLine ? 10000 : r.col));
  activeEditor.focus();
}

export async function saveFile(path = getState().activeTab ?? "") {
  const model = modelFor(path);
  if (!model) return;
  try {
    await api.post("/api/fs/write", { path, content: model.getValue() });
    savedVersion.set(path, model.getAlternativeVersionId());
    setState((s) => ({ dirty: { ...s.dirty, [path]: false } }));
    refreshGit();
  } catch (e: any) { toast(`Save failed: ${e.message}`, "error"); }
}

export async function saveAll() { for (const [p, d] of Object.entries(getState().dirty)) if (d) await saveFile(p); }

export function closeTab(path: string, force = false) {
  const s = getState();
  if (!force && s.dirty[path] && !confirm(`Do you want to discard the changes you made to ${basename(path)}?`)) return;
  const idx = s.tabs.findIndex((t) => t.path === path);
  const tabs = s.tabs.filter((t) => t.path !== path);
  const activeTab = s.activeTab === path ? (tabs[Math.min(idx, tabs.length - 1)]?.path ?? null) : s.activeTab;
  setState({ tabs, activeTab });
  if (s.dirty[path]) { modelFor(path)?.dispose(); setState((st) => ({ dirty: { ...st.dirty, [path]: false } })); }
}

/** Reload editor buffers after the agent or another program changed files on disk. */
export async function onFsChanged(paths: string[]) {
  const s = getState();
  const dirs = new Set<string>();
  for (const p of paths) {
    const d = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    dirs.add(d);
  }
  for (const d of Object.keys(s.tree)) if (dirs.has(d) || paths.includes(".")) refreshDir(d);
  refreshFiles();
  refreshGit();
  for (const m of monaco.editor.getModels()) {
    const path = m.uri.path.slice(1);
    if (m.uri.scheme !== "file" || (!paths.includes(path) && !paths.includes("."))) continue;
    if (s.dirty[path]) continue;
    const r = await api.get(`/api/fs/read?${api.q({ path })}`).catch(() => null);
    if (!r) continue;
    if (r.content !== m.getValue()) {
      m.pushEditOperations([], [{ range: m.getFullModelRange(), text: r.content }], () => null);
      savedVersion.set(path, m.getAlternativeVersionId());
      setState((st) => ({ dirty: { ...st.dirty, [path]: false } }));
    }
  }
}

export async function openDiff(file: string, original: string, source: "agent" | "git" | "apply", extra: { sessionId?: string; modified?: string } = {}) {
  const key = `diff:${file}`;
  if (!extra.modified) await ensureModel(file);
  setState((s) => ({
    tabs: s.tabs.some((t) => t.path === key)
      ? s.tabs.map((t) => (t.path === key ? { ...t, diff: { file, original, source, ...extra } } : t))
      : [...s.tabs, { path: key, kind: "diff", title: basename(file), diff: { file, original, source, ...extra } }],
    activeTab: key,
  }));
}

// ---------------------------------------------------------------------------
// Settings & models

export async function loadSettings() {
  const [settings, providers] = await Promise.all([api.get("/api/settings"), api.get("/api/providers")]);
  setState({ settings, providers });
}
export async function loadModels(refresh = false) {
  setState({ models: await api.get(`/api/models${refresh ? "?refresh=1" : ""}`).catch(() => []) });
}
export async function saveSettings(patch: any) {
  setState({ settings: await api.post("/api/settings", patch) });
  setState({ providers: await api.get("/api/providers") });
}

// ---------------------------------------------------------------------------
// Chat

export function activeChat(): Chat { const s = getState(); return s.chats.find((c) => c.id === s.activeChat) ?? s.chats[0]; }

export function createChat() {
  const c = activeChat();
  if (c && !c.messages.length) { setState({ focusComposer: Date.now(), agentVisible: true }); return c.id; }
  const chat = newChat();
  setState((s) => ({ chats: [chat, ...s.chats], openChats: [chat.id, ...s.openChats.filter((id) => s.chats.find((x) => x.id === id)?.messages.length)].slice(0, 6), activeChat: chat.id, agentVisible: true, focusComposer: Date.now() }));
  return chat.id;
}

export function switchChat(id: string) {
  setState((s) => ({ activeChat: id, openChats: s.openChats.includes(id) ? s.openChats : [id, ...s.openChats].slice(0, 6) }));
}

export function closeChatTab(id: string) {
  setState((s) => {
    const openChats = s.openChats.filter((x) => x !== id);
    if (!openChats.length) { const c = newChat(); return { chats: [c, ...s.chats], openChats: [c.id], activeChat: c.id }; }
    return { openChats, activeChat: s.activeChat === id ? openChats[0] : s.activeChat };
  });
}

export function deleteChat(id: string) {
  api.post("/api/chat/delete", { sessionId: id });
  setState((s) => ({ chats: s.chats.filter((c) => c.id !== id), openChats: s.openChats.filter((x) => x !== id) }));
  if (!getState().chats.length || !getState().openChats.length) createChat();
  if (!getState().chats.some((c) => c.id === getState().activeChat)) setState((s) => ({ activeChat: s.openChats[0] }));
}

export function sendMessage(text: string, chips: ContextChip[], opts: { mode?: Mode; model?: string } = {}) {
  const s = getState();
  const chat = activeChat();
  if (chat.running) return;
  const mode = opts.mode ?? s.composerMode;
  const model = opts.model ?? s.composerModel;
  const user: UIMessage = { id: `m_${Date.now()}`, role: "user", text, chips, mode };
  const asst: UIMessage = { id: `m_${Date.now()}_a`, role: "assistant", parts: [], model };
  updateChat(chat.id, (c) => ({
    messages: [...c.messages, user, asst],
    running: true,
    title: c.messages.length ? c.title : text.slice(0, 48) || "New Chat",
  }));

  const context: any = { files: [], images: [] };
  const ed = activeEditorPath();
  if (ed) context.currentFile = ed;
  for (const c of chips) {
    if (c.kind === "file" && c.content != null) context.files.push({ path: c.path, content: c.content });
    if (c.kind === "selection") context.selection = { path: c.path, startLine: c.startLine, endLine: c.endLine, text: c.content };
    if (c.kind === "image") context.images.push(c.dataUrl);
    if (c.kind === "terminal") context.terminal = c.content;
  }
  socket.send({ type: "chat.send", sessionId: chat.id, mode, model, text, context });
}

export function stopChat(id = activeChat().id) { socket.send({ type: "chat.stop", sessionId: id }); }

export function activeEditorPath(): string | undefined {
  const t = getState().tabs.find((t) => t.path === getState().activeTab);
  return t?.kind === "file" ? t.path : t?.diff?.file;
}

export function replyApproval(chatId: string, id: string, approved: boolean) {
  socket.send({ type: "approval.reply", id, approved });
  updateChat(chatId, (c) => ({ messages: mapLastAssistant(c.messages, (parts) => mapParts(parts, (p) => (p.type === "approval" && p.id === id ? { ...p, status: approved ? "approved" : "skipped" } : p))) }));
}

function mapParts(parts: Part[], fn: (p: Part) => Part): Part[] {
  return parts.map((p) => { const q = fn(p); return q.type === "stage" ? { ...q, parts: mapParts(q.parts, fn) } : q; });
}

function mapLastAssistant(msgs: UIMessage[], fn: (parts: Part[], m: UIMessage) => Part[], patch: Partial<UIMessage> = {}): UIMessage[] {
  const i = msgs.map((m) => m.role).lastIndexOf("assistant");
  if (i < 0) return msgs;
  const m = msgs[i];
  const out = [...msgs];
  out[i] = { ...m, ...patch, parts: fn(m.parts ?? [], m) };
  return out;
}

/** Apply a streamed agent event to the transcript. */
function reduceEvent(parts: Part[], e: any): Part[] {
  // Events tagged with a stage go inside that stage's collapsible block.
  if (e.stageId && e.kind !== "stage") {
    const idx = parts.findIndex((p) => p.type === "stage" && p.id === e.stageId);
    if (idx >= 0) {
      const st = parts[idx] as Extract<Part, { type: "stage" }>;
      const out = [...parts];
      out[idx] = { ...st, parts: reduceEvent(st.parts, { ...e, stageId: undefined }) };
      return out;
    }
  }
  const last = parts[parts.length - 1];
  switch (e.kind) {
    case "text": {
      if (last?.type === "reasoning" && !last.endedAt) parts = [...parts.slice(0, -1), { ...last, endedAt: Date.now() }];
      const l = parts[parts.length - 1];
      if (l?.type === "text") return [...parts.slice(0, -1), { ...l, text: l.text + e.delta }];
      return [...parts, { type: "text", text: e.delta }];
    }
    case "reasoning": {
      if (last?.type === "reasoning" && !last.endedAt) return [...parts.slice(0, -1), { ...last, text: last.text + e.delta }];
      return [...parts, { type: "reasoning", text: e.delta, startedAt: Date.now() }];
    }
    case "tool": {
      const closed = parts.map((p) => (p.type === "reasoning" && !p.endedAt ? { ...p, endedAt: Date.now() } : p));
      const i = closed.findIndex((p) => p.type === "tool" && p.id === e.id);
      const prev = i >= 0 ? (closed[i] as any) : {};
      const tool: Part = { type: "tool", id: e.id, name: e.name ?? prev.name, args: e.args ?? prev.args, status: e.status, output: e.output ?? prev.output, meta: e.meta ?? prev.meta };
      if (i >= 0) { const out = [...closed]; out[i] = tool; return out; }
      return [...closed, tool];
    }
    case "notice": return [...parts, { type: "notice", text: e.text }];
    case "stage": {
      const i = parts.findIndex((p) => p.type === "stage" && p.id === e.id);
      if (i >= 0) { const out = [...parts]; out[i] = { ...(parts[i] as any), label: e.label, status: e.status, model: e.model ?? (parts[i] as any).model, verdict: e.verdict, detail: e.detail }; return out; }
      return [...parts, { type: "stage", id: e.id, label: e.label, status: e.status, model: e.model, models: e.models, parts: [], proposals: [] }];
    }
    case "proposal": {
      const i = parts.findIndex((p) => p.type === "stage" && p.id === "propose");
      if (i < 0) return parts;
      const st = parts[i] as Extract<Part, { type: "stage" }>;
      const props = [...(st.proposals ?? [])];
      const j = props.findIndex((p) => p.id === e.id);
      const prev = j >= 0 ? props[j] : { id: e.id, model: e.model, text: "", status: "running" };
      const next = { ...prev, model: e.model ?? prev.model, text: prev.text + (e.delta ?? ""), status: e.status ?? prev.status };
      if (j >= 0) props[j] = next; else props.push(next);
      const out = [...parts];
      out[i] = { ...st, proposals: props };
      return out;
    }
    default: return parts;
  }
}

export function handleSocketMessage(m: any) {
  if (m.type === "socket.open") { setState({ connected: true }); return; }
  if (m.type === "socket.close") { setState({ connected: false }); return; }
  if (m.type === "fs.changed") { onFsChanged(m.paths); return; }
  if (m.type === "approval.request") {
    updateChat(m.sessionId, (c) => ({ messages: mapLastAssistant(c.messages, (parts) => [...parts, { type: "approval", id: m.id, command: m.command, status: "pending" }]) }));
    return;
  }
  if (m.type !== "chat.event") return;
  const e = m.event;
  const chat = getState().chats.find((c) => c.id === m.sessionId);
  if (!chat) return;
  if (e.kind === "done" || e.kind === "error") {
    updateChat(chat.id, (c) => ({
      running: false,
      messages: mapLastAssistant(c.messages, (parts) => parts.map((p) => (p.type === "reasoning" && !p.endedAt ? { ...p, endedAt: Date.now() } : p.type === "approval" && p.status === "pending" ? { ...p, status: "skipped" as const } : p)),
        e.kind === "error" ? { error: e.message } : e.stopped ? { stopped: true } : {}),
    }));
    return;
  }
  if (e.kind === "changes") { updateChat(chat.id, () => ({ changes: e.files })); return; }
  if (e.kind === "model") { updateChat(chat.id, (c) => ({ messages: mapLastAssistant(c.messages, (p) => p, { model: e.model }) })); return; }
  updateChat(chat.id, (c) => ({ messages: mapLastAssistant(c.messages, (parts) => reduceEvent(parts, e)) }));
}

export async function keepChanges(chatId: string, path?: string) {
  await api.post("/api/chat/accept", { sessionId: chatId, path });
  updateChat(chatId, (c) => ({ changes: path ? c.changes.filter((f) => f.path !== path) : [] }));
  if (path) closeTab(`diff:${path}`, true);
}

export async function undoChanges(chatId: string, path?: string) {
  await api.post("/api/chat/revert", { sessionId: chatId, path });
  updateChat(chatId, (c) => ({ changes: path ? c.changes.filter((f) => f.path !== path) : [] }));
  if (path) closeTab(`diff:${path}`, true);
}

export async function reviewChange(chatId: string, path: string) {
  const r = await api.get(`/api/chat/original?${api.q({ sessionId: chatId, path })}`);
  openDiff(path, r.content ?? "", "agent", { sessionId: chatId });
}

// ---------------------------------------------------------------------------
// Commands (palette + keybindings)

export interface Command { id: string; label: string; keys?: string; run: () => void; category?: string }

export const toggleSidebar = () => setState((s) => ({ sidebarVisible: !s.sidebarVisible }));
export const togglePanel = () => setState((s) => ({ panelVisible: !s.panelVisible }));
export const toggleAgent = () => setState((s) => ({ agentVisible: !s.agentVisible }));
export const focusAgent = () => setState({ agentVisible: true, focusComposer: Date.now() });
export const openSettings = (section = "models") => setState({ settingsOpen: true, settingsSection: section });
