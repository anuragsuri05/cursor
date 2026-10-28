import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import {
  activeChat, activeEditorPath, closeChatTab, createChat, deleteChat, keepChanges, openFile, openSettings, replyApproval,
  reviewChange, saveSettings, sendMessage, stopChat, switchChat, undoChanges,
} from "../lib/actions";
import { basename, getState, MOD, setState, useStore, type Chat, type ContextChip, type Mode, type Part, type UIMessage } from "../lib/store";
import { Markdown } from "./Markdown";
import { ModelPicker, modelLabel } from "./ModelPicker";
import { FileIcon, Icon, IconButton, Popover, Spinner } from "./small";

// ---------------------------------------------------------------------------
// Composer context chips (shared so the explorer/editor can add to them)

let chips: ContextChip[] = [];
const chipListeners = new Set<() => void>();
const setChips = (c: ContextChip[]) => { chips = c; chipListeners.forEach((l) => l()); };
export function addChip(c: ContextChip) {
  if (chips.some((x) => x.kind === c.kind && x.label === c.label)) return;
  setChips([...chips, c]);
}
const useChips = () => useSyncExternalStore((cb) => { chipListeners.add(cb); return () => chipListeners.delete(cb); }, () => chips);

const MODES: { id: Mode; label: string; icon: string; desc: string; key?: string }[] = [
  { id: "agent", label: "Agent", icon: "infinity", desc: "Plan, search, build anything", key: `${MOD}I` },
  { id: "plan", label: "Plan", icon: "checklist", desc: "Create detailed plans before building" },
  { id: "ask", label: "Ask", icon: "comment-discussion", desc: "Ask questions about your codebase (read-only)" },
];

export function AgentPanel() {
  const chat = useStore((s) => s.chats.find((c) => c.id === s.activeChat) ?? s.chats[0]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => { stick.current = true; }, [chat.id]);

  return (
    <div className="agent-inner">
      <AgentHeader chat={chat} />
      <div className="agent-scroll" ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {chat.messages.length === 0 ? <EmptyChat /> : <Transcript chat={chat} />}
      </div>
      <ChangesBar chat={chat} />
      <Composer chat={chat} />
    </div>
  );
}

function AgentHeader({ chat }: { chat: Chat }) {
  const openChats = useStore((s) => s.openChats);
  const chats = useStore((s) => s.chats);
  const maximized = useStore((s) => s.agentMaximized);
  const [hist, setHist] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  return (
    <div className="agent-header">
      <div className="chat-tabs">
        {openChats.map((id) => {
          const c = chats.find((x) => x.id === id);
          if (!c) return null;
          return (
            <div key={id} className={`chat-tab ${id === chat.id ? "active" : ""}`} onClick={() => switchChat(id)} title={c.title}>
              {c.running && <Spinner />}
              <span className="chat-tab-title">{c.title}</span>
              <span className="chat-tab-close" onClick={(e) => { e.stopPropagation(); closeChatTab(id); }}><Icon name="close" /></span>
            </div>
          );
        })}
      </div>
      <div className="agent-actions">
        <IconButton icon="add" title={`New Chat (${MOD}N)`} onClick={createChat} />
        <div className="picker-anchor">
          <IconButton icon="history" title="Chat History" onClick={() => setHist(!hist)} />
          <Popover open={hist} onClose={() => setHist(false)} className="history-menu">
            <div className="menu-search"><input autoFocus placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="menu-scroll">
              {chats.filter((c) => c.messages.length && c.title.toLowerCase().includes(q.toLowerCase())).map((c) => (
                <div key={c.id} className={`history-row ${c.id === chat.id ? "selected" : ""}`} onClick={() => { switchChat(c.id); setHist(false); }}>
                  <Icon name="comment" />
                  <span className="history-title">{c.title}</span>
                  <span className="history-time">{ago(c.updatedAt)}</span>
                  <span className="history-del" onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}><Icon name="trash" /></span>
                </div>
              ))}
              {!chats.some((c) => c.messages.length) && <div className="menu-empty">No previous chats</div>}
            </div>
          </Popover>
        </div>
        <div className="picker-anchor">
          <IconButton icon="ellipsis" title="More" onClick={() => setMenu(!menu)} />
          <Popover open={menu} onClose={() => setMenu(false)} className="context-menu right">
            <div className="menu-item" onClick={() => { setMenu(false); setState((s) => ({ agentMaximized: !s.agentMaximized })); }}><span>{maximized ? "Restore Layout" : "Maximize Chat"}</span><span className="menu-keys">{MOD}E</span></div>
            <div className="menu-item" onClick={() => { setMenu(false); exportChat(chat); }}><span>Export Chat as Markdown</span></div>
            <div className="menu-item" onClick={() => { setMenu(false); openSettings("rules"); }}><span>Rules & Memories</span></div>
            <div className="menu-item" onClick={() => { setMenu(false); openSettings("ensemble"); }}><span>Ensemble Settings</span></div>
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { setMenu(false); setState({ agentVisible: false, agentMaximized: false }); }}><span>Close Chat</span><span className="menu-keys">{MOD}I</span></div>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function exportChat(chat: Chat) {
  const md = chat.messages.map((m) => m.role === "user" ? `## User\n\n${m.text}` : `## Assistant\n\n${(m.parts ?? []).filter((p) => p.type === "text").map((p: any) => p.text).join("\n")}`).join("\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  a.download = `${chat.title.replace(/[^\w-]+/g, "_")}.md`;
  a.click();
}

const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

function EmptyChat() {
  const models = useStore((s) => s.models);
  const free = models.filter((m) => m.tier === "free" || m.tier === "local").length;
  return (
    <div className="empty-chat">
      {models.length === 0 ? (
        <div className="onboard-card">
          <div className="onboard-title"><Spinner /> Loading free models…</div>
          <p>Spacebar includes free models that need no setup (LLM7, Pollinations, and OpenCode Zen if OpenCode is installed). If none appear, check your internet connection or add a free key.</p>
          <button className="btn primary" onClick={() => openSettings("models")}>Open model settings</button>
        </div>
      ) : (
        <div className="empty-chat-hint">
          <div className="hint-row"><Icon name="sparkle" /> <span><b>{free} free models ready</b> — no keys needed. Pick one below, or leave it on <b>Auto</b>.</span></div>
          <div className="hint-row"><Icon name="organization" /> <span><b>Ensemble Max</b> combines {Math.min(free, 3) || "several"} free models — draft in parallel, synthesize, then review — for results beyond any single model.</span></div>
          <div className="hint-row"><Icon name="infinity" /> <span><b>Agent</b> edits files, runs commands and verifies its work. <span className="kbd">⇧Tab</span> switches modes.</span></div>
          <div className="hint-row"><Icon name="mention" /> <span>Type <b>@</b> to add files, or select code and press <span className="kbd">{MOD}L</span>.</span></div>
        </div>
      )}
    </div>
  );
}

function Transcript({ chat }: { chat: Chat }) {
  // Group as turns so the user's message can stick to the top while its answer scrolls.
  const turns: [UIMessage, UIMessage | undefined][] = [];
  chat.messages.forEach((m, i) => { if (m.role === "user") turns.push([m, chat.messages[i + 1]?.role === "assistant" ? chat.messages[i + 1] : undefined]); });
  return (
    <div className="transcript">
      {turns.map(([u, a], i) => (
        <div className="turn" key={u.id}>
          <UserMessage msg={u} />
          {a && <AssistantMessage msg={a} chat={chat} last={i === turns.length - 1} />}
        </div>
      ))}
    </div>
  );
}

function UserMessage({ msg }: { msg: UIMessage }) {
  return (
    <div className="user-msg">
      {msg.chips && msg.chips.length > 0 && (
        <div className="chip-row">{msg.chips.map((c, i) => <ChipView key={i} chip={c} />)}</div>
      )}
      <div className="user-text">{msg.text}</div>
      {msg.mode && msg.mode !== "agent" && <span className="user-mode">{msg.mode}</span>}
    </div>
  );
}

function AssistantMessage({ msg, chat, last }: { msg: UIMessage; chat: Chat; last: boolean }) {
  const running = chat.running && last;
  const parts = msg.parts ?? [];
  const models = useStore((s) => s.models);
  const userMsg = chat.messages[chat.messages.indexOf(msg) - 1];
  const text = parts.filter((p) => p.type === "text").map((p: any) => p.text).join("\n");
  return (
    <div className="assistant-msg">
      {parts.map((p, i) => <PartView key={i} part={p} chat={chat} streaming={running && i === parts.length - 1} />)}
      {running && !parts.length && <div className="thinking-line"><span className="shimmer">Planning next moves</span></div>}
      {running && parts.length > 0 && parts[parts.length - 1].type !== "text" && <div className="thinking-line"><span className="shimmer">Working</span></div>}
      {msg.error && (
        <div className="error-box">
          <Icon name="error" />
          <div className="error-text">{msg.error}</div>
          {userMsg && <button className="btn ghost sm" onClick={() => sendMessage(userMsg.text ?? "", userMsg.chips ?? [], { mode: userMsg.mode })}>Retry</button>}
        </div>
      )}
      {msg.stopped && <div className="notice"><Icon name="debug-stop" /> Stopped</div>}
      {!running && (parts.length > 0 || msg.error) && (
        <div className="msg-footer">
          {msg.model && <span className="msg-model">{modelLabel(msg.model, models)}</span>}
          <span className="spacer" />
          {text && <IconButton icon="copy" title="Copy" onClick={() => navigator.clipboard.writeText(text)} />}
          {last && userMsg?.mode === "plan" && text && (
            <button className="btn primary sm" onClick={() => sendMessage("Implement the plan above.", [], { mode: "agent" })}><Icon name="play" /> Build</button>
          )}
        </div>
      )}
    </div>
  );
}

function PartView({ part, chat, streaming }: { part: Part; chat: Chat; streaming: boolean }) {
  switch (part.type) {
    case "text": return <Markdown text={part.text} streaming={streaming} />;
    case "reasoning": return <Reasoning part={part} />;
    case "tool": return <ToolView part={part} chat={chat} />;
    case "notice": return <div className="notice"><Icon name="info" /> {part.text}</div>;
    case "approval": return <ApprovalView part={part} chat={chat} />;
    case "stage": return <StageView part={part} chat={chat} />;
  }
}

function Reasoning({ part }: { part: Extract<Part, { type: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  const done = !!part.endedAt;
  const secs = Math.max(1, Math.round(((part.endedAt ?? Date.now()) - part.startedAt) / 1000));
  return (
    <div className="reasoning">
      <div className="reasoning-head" onClick={() => setOpen(!open)}>
        <span className={done ? "" : "shimmer"}>{done ? `Thought for ${secs}s` : "Thinking"}</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} />
      </div>
      {(open || !done) && <div className={`reasoning-body ${!done && !open ? "peek" : ""}`}>{done || open ? part.text : part.text.slice(-400)}</div>}
    </div>
  );
}

const TOOL_VERBS: Record<string, [string, string, string]> = {
  read_file: ["Reading", "Read", "file"],
  list_dir: ["Listing", "Listed", "folder"],
  grep: ["Grepping", "Grepped", "search"],
  find_files: ["Searching", "Searched files", "search"],
  edit_file: ["Editing", "Edited", "edit"],
  write_file: ["Writing", "Wrote", "edit"],
  delete_file: ["Deleting", "Deleted", "trash"],
  run_command: ["Running", "Ran", "terminal"],
};

function ToolView({ part, chat }: { part: Extract<Part, { type: "tool" }>; chat: Chat }) {
  const [open, setOpen] = useState(false);
  const [verbIng, verbEd] = TOOL_VERBS[part.name] ?? ["Calling", "Called", "tools"];
  const running = part.status === "running";
  const a = part.args ?? {};
  const failed = part.status === "error";

  if (part.name === "edit_file" || part.name === "write_file" || part.name === "delete_file") {
    const change = chat.changes.find((c) => c.path === a.path);
    const added = part.meta?.added ?? 0, removed = part.meta?.removed ?? 0;
    return (
      <div className={`tool-file ${failed ? "failed" : ""}`} onClick={() => (change ? reviewChange(chat.id, a.path) : a.path && openFile(a.path))}>
        {running ? <Spinner /> : <FileIcon name={basename(a.path ?? "")} />}
        <span className="tool-file-name">{basename(a.path ?? "file")}</span>
        {!running && !failed && <span className="diffstat"><span className="add">+{added}</span> <span className="del">-{removed}</span></span>}
        {failed && <span className="tool-fail" title={part.output}>Failed</span>}
        <span className="spacer" />
        {running && <span className="shimmer small">{verbIng}</span>}
        {failed && <span className="tool-err-text">{part.output?.replace(/^Error: /, "").slice(0, 80)}</span>}
      </div>
    );
  }

  if (part.name === "run_command") {
    return (
      <div className={`tool-terminal ${failed || (part.meta?.exitCode ?? 0) !== 0 ? "failed" : ""}`}>
        <div className="tool-terminal-head" onClick={() => setOpen(!open)}>
          <Icon name="terminal" />
          <code className="tool-cmd">{a.command}</code>
          <span className="spacer" />
          {running ? <Spinner /> : part.meta?.skipped ? <span className="muted">Skipped</span> : <span className={`exit ${part.meta?.exitCode === 0 ? "ok" : "bad"}`}>{part.meta?.exitCode === 0 ? <Icon name="check" /> : `exit ${part.meta?.exitCode ?? "?"}`}</span>}
          <Icon name={open ? "chevron-down" : "chevron-right"} />
        </div>
        {open && part.output && <pre className="tool-output">{part.output.replace(/^exit code: -?\d+\n/, "")}</pre>}
      </div>
    );
  }

  let target = "";
  if (part.name === "read_file") target = `${basename(a.path ?? "")}${part.meta?.start ? ` L${part.meta.start}-${part.meta.end}` : ""}`;
  else if (part.name === "list_dir") target = a.path === "." ? "workspace" : a.path;
  else if (part.name === "grep") target = `"${a.query}"${part.meta?.count != null ? ` · ${part.meta.count} results` : ""}`;
  else if (part.name === "find_files") target = `"${a.pattern}"`;
  else target = JSON.stringify(a).slice(0, 60);

  return (
    <div className={`tool-line ${failed ? "failed" : ""}`}>
      <div className="tool-line-head" onClick={() => setOpen(!open)}>
        <span className={running ? "shimmer" : "tool-verb"}>{running ? verbIng : verbEd}</span>
        <span className="tool-target" onClick={(e) => { if (part.name === "read_file" && a.path) { e.stopPropagation(); openFile(a.path, { line: part.meta?.start }); } }}>{target}</span>
        {part.output && <Icon name={open ? "chevron-down" : "chevron-right"} className="tool-chev" />}
      </div>
      {open && part.output && <pre className="tool-output">{part.output.slice(0, 4000)}</pre>}
    </div>
  );
}

function ApprovalView({ part, chat }: { part: Extract<Part, { type: "approval" }>; chat: Chat }) {
  const settings = useStore((s) => s.settings);
  if (part.status !== "pending") return null;
  const first = part.command.trim().split(/\s+/).slice(0, part.command.startsWith("npm") || part.command.startsWith("git") ? 2 : 1).join(" ");
  return (
    <div className="approval">
      <div className="approval-head"><Icon name="terminal" /> Run command?</div>
      <pre className="approval-cmd">{part.command}</pre>
      <div className="approval-actions">
        <button className="btn ghost sm" onClick={() => {
          saveSettings({ agent: { ...settings.agent, allowlist: [...settings.agent.allowlist, first] } });
          replyApproval(chat.id, part.id, true);
        }}>Always allow "{first}"</button>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => replyApproval(chat.id, part.id, false)}>Skip</button>
        <button className="btn primary sm" autoFocus onClick={() => replyApproval(chat.id, part.id, true)}>Run <span className="kbd-inline">⏎</span></button>
      </div>
    </div>
  );
}

function StageView({ part, chat }: { part: Extract<Part, { type: "stage" }>; chat: Chat }) {
  const running = part.status === "running";
  const [open, setOpen] = useState(false);
  const models = useStore((s) => s.models);
  const hasBody = part.parts.length > 0 || (part.proposals?.length ?? 0) > 0;
  const icon = part.id.startsWith("review") ? (part.verdict === "pass" ? "pass" : part.verdict === "issues" ? "warning" : "eye") : part.id === "scout" ? "search" : part.id === "propose" ? "organization" : part.id === "synth" ? "merge" : part.id.startsWith("fix") ? "tools" : "rocket";
  return (
    <div className={`stage ${part.status}`}>
      <div className="stage-head" onClick={() => hasBody && setOpen(!open)}>
        {running ? <Spinner /> : <Icon name={part.status === "error" ? "error" : icon} className={`stage-icon ${part.verdict ?? ""}`} />}
        <span className={running ? "shimmer" : "stage-label"}>{part.label}</span>
        {part.model && <span className="stage-model">{modelLabel(part.model, models)}</span>}
        <span className="spacer" />
        {hasBody && <Icon name={open || (running && part.id === "propose") ? "chevron-down" : "chevron-right"} />}
      </div>
      {(open || (running && part.id === "propose")) && (
        <div className="stage-body">
          {part.proposals?.map((p) => <Proposal key={p.id} p={p} models={models} />)}
          {part.parts.map((sp, i) => <PartView key={i} part={sp} chat={chat} streaming={running && i === part.parts.length - 1} />)}
        </div>
      )}
    </div>
  );
}

function Proposal({ p, models }: { p: { id: string; model: string; text: string; status: string }; models: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="proposal">
      <div className="proposal-head" onClick={() => setOpen(!open)}>
        {p.status === "running" ? <Spinner /> : <Icon name={p.status === "error" ? "error" : "check"} />}
        <span>{modelLabel(p.model, models)}</span>
        <span className="muted">{p.text.length ? `${p.text.length} chars` : ""}</span>
        <span className="spacer" />
        <Icon name={open ? "chevron-down" : "chevron-right"} />
      </div>
      {open ? <div className="proposal-body"><Markdown text={p.text} streaming={p.status === "running"} /></div>
        : p.status === "running" && <div className="proposal-peek">{p.text.slice(-160)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChangesBar({ chat }: { chat: Chat }) {
  const [open, setOpen] = useState(false);
  if (!chat.changes.length || chat.running) return null;
  const added = chat.changes.reduce((n, c) => n + c.added, 0), removed = chat.changes.reduce((n, c) => n + c.removed, 0);
  return (
    <div className="changes-bar">
      <div className="changes-head">
        <span className="changes-toggle" onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} />
          {chat.changes.length} File{chat.changes.length > 1 ? "s" : ""}
          <span className="diffstat"><span className="add">+{added}</span> <span className="del">-{removed}</span></span>
        </span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => undoChanges(chat.id)}>Undo All</button>
        <button className="btn primary sm" onClick={() => keepChanges(chat.id)}>Keep All</button>
        <button className="btn ghost sm" onClick={() => reviewChange(chat.id, chat.changes[0].path)}>Review</button>
      </div>
      {open && chat.changes.map((c) => (
        <div key={c.path} className="change-row" onClick={() => reviewChange(chat.id, c.path)}>
          <FileIcon name={basename(c.path)} />
          <span className="change-name">{basename(c.path)}</span>
          <span className="search-dir">{c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : ""}</span>
          <span className="diffstat"><span className="add">+{c.added}</span> <span className="del">-{c.removed}</span></span>
          <span className="spacer" />
          <IconButton icon="discard" title="Undo" onClick={(e) => { e.stopPropagation(); undoChanges(chat.id, c.path); }} />
          <IconButton icon="check" title="Keep" onClick={(e) => { e.stopPropagation(); keepChanges(chat.id, c.path); }} />
        </div>
      ))}
    </div>
  );
}

function ChipView({ chip, onRemove, dim }: { chip: ContextChip; onRemove?: () => void; dim?: boolean }) {
  const icon = chip.kind === "image" ? null : chip.kind === "selection" ? "symbol-snippet" : chip.kind === "terminal" ? "terminal" : null;
  return (
    <span className={`ctx-chip ${dim ? "dim" : ""}`} onClick={() => chip.path && openFile(chip.path, { line: chip.startLine, endLine: chip.endLine })}>
      {chip.kind === "image" ? <img src={chip.dataUrl} alt="" /> : icon ? <Icon name={icon} /> : <FileIcon name={chip.label} />}
      <span>{chip.label}</span>
      {onRemove && <span className="ctx-chip-x" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="close" /></span>}
    </span>
  );
}

function Composer({ chat }: { chat: Chat }) {
  const mode = useStore((s) => s.composerMode);
  const model = useStore((s) => s.composerModel);
  const focusTick = useStore((s) => s.focusComposer);
  const files = useStore((s) => s.files);
  const activeTab = useStore((s) => s.activeTab);
  const chipList = useChips();
  const [text, setText] = useState("");
  const [modeOpen, setModeOpen] = useState(false);
  const [mention, setMention] = useState<{ q: string; idx: number } | null>(null);
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const current = activeTab ? activeEditorPath() : undefined;

  useEffect(() => { ta.current?.focus(); }, [focusTick, chat.id]);
  useEffect(() => { setIncludeCurrent(true); }, [current]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, [text]);

  const mentionItems = useMemo(() => {
    if (!mention) return [];
    const q = mention.q.toLowerCase();
    const score = (f: string) => { const b = basename(f).toLowerCase(); return b.startsWith(q) ? 0 : b.includes(q) ? 1 : f.toLowerCase().includes(q) ? 2 : 9; };
    return files.filter((f) => score(f) < 9).sort((a, b) => score(a) - score(b) || a.length - b.length).slice(0, 12);
  }, [mention, files]);

  const pickMention = async (path: string) => {
    const r = await api.get(`/api/fs/read?${api.q({ path })}`).catch(() => ({ content: "" }));
    addChip({ kind: "file", label: basename(path), path, content: r.content });
    setText((t) => t.replace(/@[^\s@]*$/, ""));
    setMention(null);
    ta.current?.focus();
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || chat.running) return;
    const all = [...chipList];
    if (includeCurrent && current && !all.some((c) => c.path === current)) {
      // Like Cursor: the open file is offered as context (path only; the agent reads it if needed).
      all.unshift({ kind: "file", label: basename(current), path: current });
    }
    sendMessage(t, all);
    setText("");
    setChips([]);
  };

  const cycleMode = () => {
    const i = MODES.findIndex((m) => m.id === mode);
    setState({ composerMode: MODES[(i + 1) % MODES.length].id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionItems.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, idx: (mention.idx + 1) % mentionItems.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention({ ...mention, idx: (mention.idx - 1 + mentionItems.length) % mentionItems.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionItems[mention.idx]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cycleMode(); }
    else if (e.key === "." && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setModeOpen(true); }
    else if (e.key === "Backspace" && !text && chipList.length) setChips(chipList.slice(0, -1));
    else if (e.key === "Escape" && chat.running) stopChat(chat.id);
  };

  const onChange = (v: string) => {
    setText(v);
    const m = v.match(/@([^\s@]*)$/);
    setMention(m ? { q: m[1], idx: 0 } : null);
  };

  const addImages = (fileList: FileList | File[]) => {
    for (const f of Array.from(fileList)) {
      if (!f.type.startsWith("image/")) continue;
      const r = new FileReader();
      r.onload = () => addChip({ kind: "image", label: f.name || "image.png", dataUrl: String(r.result) });
      r.readAsDataURL(f);
    }
  };

  const modeInfo = MODES.find((m) => m.id === mode)!;
  return (
    <div className="composer-wrap">
      <div className={`composer ${chat.running ? "running" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const p = e.dataTransfer.getData("spacebar/path");
          if (p) pickMention(p); else addImages(e.dataTransfer.files);
        }}>
        <div className="chip-row">
          <button className="ctx-add" title="Add Context (@)" onClick={() => { setText((t) => t + (t && !t.endsWith(" ") ? " @" : "@")); setMention({ q: "", idx: 0 }); ta.current?.focus(); }}>
            <Icon name="mention" />{!chipList.length && !current && <span>Add Context</span>}
          </button>
          {current && includeCurrent && !chipList.some((c) => c.path === current) && (
            <ChipView chip={{ kind: "file", label: basename(current), path: current }} dim onRemove={() => setIncludeCurrent(false)} />
          )}
          {chipList.map((c, i) => <ChipView key={i} chip={c} onRemove={() => setChips(chipList.filter((_, j) => j !== i))} />)}
        </div>
        <textarea
          ref={ta}
          value={text}
          rows={1}
          placeholder={chat.messages.length ? "Add a follow-up" : mode === "plan" ? "Describe what to plan" : mode === "ask" ? "Ask anything about your code" : "Plan, search, build anything"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addImages(e.clipboardData.files); } }}
        />
        {mention && mentionItems.length > 0 && (
          <div className="mention-menu">
            <div className="menu-group">Files</div>
            {mentionItems.map((f, i) => (
              <div key={f} className={`mention-row ${i === mention.idx ? "selected" : ""}`} onMouseDown={(e) => { e.preventDefault(); pickMention(f); }}>
                <FileIcon name={basename(f)} /><span>{basename(f)}</span><span className="search-dir">{f}</span>
              </div>
            ))}
          </div>
        )}
        <div className="composer-footer">
          <div className="picker-anchor">
            <button className={`chip-btn mode-btn mode-${mode}`} onClick={() => setModeOpen(!modeOpen)} title={`Mode (⇧Tab to switch, ${MOD}. for menu)`}>
              <Icon name={modeInfo.icon} /><span>{modeInfo.label}</span><Icon name="chevron-down" className="chev" />
            </button>
            <Popover open={modeOpen} onClose={() => setModeOpen(false)} className="mode-menu up">
              {MODES.map((m) => (
                <div key={m.id} className={`mode-row ${m.id === mode ? "selected" : ""}`} onClick={() => { setState({ composerMode: m.id }); setModeOpen(false); ta.current?.focus(); }}>
                  <Icon name={m.icon} />
                  <div className="mode-text"><span className="mode-name">{m.label}</span><span className="mode-desc">{m.desc}</span></div>
                  {m.key && <span className="menu-keys">{m.key}</span>}
                  {m.id === mode && <Icon name="check" />}
                </div>
              ))}
            </Popover>
          </div>
          <ModelPicker value={model} onChange={(v) => setState({ composerModel: v })} up />
          <span className="spacer" />
          <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ""; }} />
          <IconButton icon="file-media" title="Attach image" onClick={() => imgInput.current?.click()} />
          {chat.running ? (
            <button className="send-btn stop" title="Stop (Esc)" onClick={() => stopChat(chat.id)}><span className="stop-square" /></button>
          ) : (
            <button className="send-btn" title="Send (⏎)" disabled={!text.trim()} onClick={submit}><Icon name="arrow-up" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

export { getState };
