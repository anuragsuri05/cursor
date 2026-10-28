import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeEditor, closeTab, createChat, focusAgent, loadModels, openFile, openSettings, saveAll, saveFile, toggleAgent, togglePanel, toggleSidebar, type Command,
} from "../lib/actions";
import { basename, dirname, getState, MOD, setState, useStore } from "../lib/store";
import { FileIcon, Icon } from "./small";

function fuzzy(q: string, s: string): number {
  if (!q) return 1;
  q = q.toLowerCase(); s = s.toLowerCase();
  let qi = 0, score = 0, last = -1;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { score += i === last + 1 ? 3 : 1; if (i === 0 || "/._- ".includes(s[i - 1])) score += 2; last = i; qi++; }
  }
  return qi === q.length ? score : 0;
}

export function CommandPalette() {
  const mode = useStore((s) => s.palette);
  const files = useStore((s) => s.files);
  const tabs = useStore((s) => s.tabs);
  const [q, setQ] = useState(mode === "commands" ? ">" : "");
  const [idx, setIdx] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => setState({ palette: null });

  const commands: Command[] = useMemo(() => [
    { id: "agent.new", label: "Agent: New Chat", keys: `${MOD}N`, run: createChat },
    { id: "agent.focus", label: "Agent: Open Agent", keys: `${MOD}I`, run: focusAgent },
    { id: "agent.toggle", label: "View: Toggle Agent Panel", keys: `${MOD}I`, run: toggleAgent },
    { id: "agent.max", label: "Agent: Maximize Chat", keys: `${MOD}E`, run: () => setState((s) => ({ agentMaximized: !s.agentMaximized, agentVisible: true })) },
    { id: "mode.agent", label: "Agent: Switch to Agent Mode", run: () => { setState({ composerMode: "agent" }); focusAgent(); } },
    { id: "mode.plan", label: "Agent: Switch to Plan Mode", run: () => { setState({ composerMode: "plan" }); focusAgent(); } },
    { id: "mode.ask", label: "Agent: Switch to Ask Mode", run: () => { setState({ composerMode: "ask" }); focusAgent(); } },
    { id: "inline", label: "Spacebar: Edit Inline", keys: `${MOD}K`, run: () => setTimeout(() => activeEditor?.getAction("spacebar.inlineEdit")?.run(), 50) },
    { id: "settings", label: "Spacebar: Open Settings", keys: `⇧${MOD}J`, run: () => openSettings("general") },
    { id: "settings.models", label: "Spacebar: Models & API Keys", run: () => openSettings("models") },
    { id: "settings.ensemble", label: "Spacebar: Configure Ensembles", run: () => openSettings("ensemble") },
    { id: "settings.rules", label: "Spacebar: Rules", run: () => openSettings("rules") },
    { id: "models.refresh", label: "Spacebar: Refresh Model List", run: () => loadModels(true) },
    { id: "tab.toggle", label: "Spacebar: Toggle Tab Autocomplete", run: () => import("../lib/actions").then((a) => a.saveSettings({ tabEnabled: !getState().settings?.tabEnabled })) },
    { id: "file.open", label: "File: Open Folder...", keys: `${MOD}O`, run: () => setState({ folderPickerOpen: true }) },
    { id: "file.save", label: "File: Save", keys: `${MOD}S`, run: () => saveFile() },
    { id: "file.saveAll", label: "File: Save All", keys: `⌥${MOD}S`, run: saveAll },
    { id: "file.close", label: "View: Close Editor", keys: `${MOD}W`, run: () => { const t = getState().activeTab; if (t) closeTab(t); } },
    { id: "file.closeAll", label: "View: Close All Editors", run: () => setState({ tabs: [], activeTab: null }) },
    { id: "view.sidebar", label: "View: Toggle Primary Side Bar", keys: `${MOD}B`, run: toggleSidebar },
    { id: "view.panel", label: "View: Toggle Panel", keys: `${MOD}J`, run: togglePanel },
    { id: "view.terminal", label: "Terminal: Create New Terminal", keys: "⌃`", run: () => setState({ panelVisible: true, panelView: "terminal" }) },
    { id: "view.explorer", label: "View: Show Explorer", keys: `⇧${MOD}E`, run: () => setState({ sidebarVisible: true, sidebarView: "explorer" }) },
    { id: "view.search", label: "View: Show Search", keys: `⇧${MOD}F`, run: () => setState({ sidebarVisible: true, sidebarView: "search" }) },
    { id: "view.scm", label: "View: Show Source Control", keys: "⌃⇧G", run: () => setState({ sidebarVisible: true, sidebarView: "scm" }) },
    { id: "view.problems", label: "View: Show Problems", run: () => setState({ panelVisible: true, panelView: "problems" }) },
    { id: "editor.format", label: "Format Document", keys: "⇧⌥F", run: () => setTimeout(() => activeEditor?.getAction("editor.action.formatDocument")?.run(), 50) },
    { id: "editor.goto", label: "Go to Line...", keys: "⌃G", run: () => setTimeout(() => { activeEditor?.focus(); activeEditor?.getAction("editor.action.gotoLine")?.run(); }, 50) },
    { id: "editor.symbol", label: "Go to Symbol in Editor...", keys: `⇧${MOD}O`, run: () => setTimeout(() => { activeEditor?.focus(); activeEditor?.getAction("editor.action.quickOutline")?.run(); }, 50) },
    { id: "reload", label: "Developer: Reload Window", run: () => location.reload() },
  ], []);

  const isCmd = q.startsWith(">");
  const query = isCmd ? q.slice(1).trim() : q.trim();
  const lineMatch = !isCmd && query.match(/^(.*?)(?::(\d+))?$/);
  const fileQuery = lineMatch ? lineMatch[1] : query;

  const items = useMemo(() => {
    if (isCmd) return commands.map((c) => ({ c, s: fuzzy(query, c.label) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => ({ kind: "cmd" as const, cmd: x.c }));
    const recent = tabs.filter((t) => t.kind === "file").map((t) => t.path).reverse();
    const pool = fileQuery ? files : [...recent, ...files.filter((f) => !recent.includes(f))];
    return pool.map((f) => ({ f, s: fuzzy(fileQuery, basename(f)) * 2 + fuzzy(fileQuery, f) }))
      .filter((x) => x.s > 0).sort((a, b) => (fileQuery ? b.s - a.s || a.f.length - b.f.length : 0)).slice(0, 60)
      .map((x) => ({ kind: "file" as const, path: x.f, recent: recent.includes(x.f) }));
  }, [q, files, tabs]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => { list.current?.children[idx]?.scrollIntoView({ block: "nearest" }); }, [idx]);

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.kind === "cmd") it.cmd.run();
    else openFile(it.path, { line: lineMatch && lineMatch[2] ? Number(lineMatch[2]) : undefined });
  };

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder={isCmd ? "" : "Search files by name (append :<line> to go to line, or start with > for commands)"}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); run(idx); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
        />
        <div className="palette-list" ref={list}>
          {items.map((it, i) => (
            <div key={i} className={`palette-row ${i === idx ? "selected" : ""}`} onMouseMove={() => setIdx(i)} onClick={() => run(i)}>
              {it.kind === "cmd" ? (
                <>
                  <span className="palette-label">{it.cmd.label}</span>
                  {it.cmd.keys && <span className="kbd">{it.cmd.keys}</span>}
                </>
              ) : (
                <>
                  <FileIcon name={basename(it.path)} />
                  <span className="palette-label">{basename(it.path)}</span>
                  <span className="search-dir">{dirname(it.path)}</span>
                  {it.recent && !fileQuery && <span className="palette-tag">recently opened</span>}
                </>
              )}
            </div>
          ))}
          {!items.length && <div className="palette-empty">No matching {isCmd ? "commands" : "files"}</div>}
        </div>
      </div>
    </div>
  );
}

export { Icon };
