import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { closeTab, focusAgent, openDiff, openFile, refreshDir, refreshGit, revealInExplorer, toggleDir } from "../lib/actions";
import { basename, dirname, getState, setState, toast, useStore, type TreeNode } from "../lib/store";
import { addChip } from "./AgentPanel";
import { ContextMenu, FileIcon, Icon, IconButton, Spinner } from "./small";

export function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  const tabs: [typeof view, string, string][] = [["explorer", "files", "Explorer"], ["search", "search", "Search"], ["scm", "source-control", "Source Control"]];
  const changes = useStore((s) => s.git.files.length);
  return (
    <div className="sidebar-inner">
      <div className="sidebar-tabs">
        {tabs.map(([id, icon, label]) => (
          <button key={id} className={`sidebar-tab ${view === id ? "active" : ""}`} title={label} onClick={() => setState({ sidebarView: id })}>
            <Icon name={icon} />
            {id === "scm" && changes > 0 && <span className="badge">{changes}</span>}
          </button>
        ))}
      </div>
      {view === "explorer" && <Explorer />}
      {view === "search" && <SearchView />}
      {view === "scm" && <ScmView />}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Pending = { kind: "file" | "dir"; parent: string } | { kind: "rename"; path: string } | null;

function Explorer() {
  const ws = useStore((s) => s.workspace);
  const root = useStore((s) => s.tree["."]);
  const [pending, setPending] = useState<Pending>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);

  const targetDir = () => {
    const sel = getState().selectedPath;
    if (!sel) return ".";
    const node = Object.values(getState().tree).flat().find((n) => n.path === sel);
    return node?.type === "dir" ? sel : dirname(sel) || ".";
  };
  const startCreate = (kind: "file" | "dir", parent = targetDir()) => {
    if (parent !== ".") setState((s) => ({ expanded: { ...s.expanded, [parent]: true } }));
    if (parent !== "." && !getState().tree[parent]) refreshDir(parent);
    setPending({ kind, parent });
  };

  const commit = async (name: string) => {
    const p = pending;
    setPending(null);
    if (!p || !name.trim()) return;
    try {
      if (p.kind === "rename") {
        const to = (dirname(p.path) ? dirname(p.path) + "/" : "") + name;
        if (to === p.path) return;
        await api.post("/api/fs/rename", { from: p.path, to });
        closeTab(p.path, true);
        refreshDir(dirname(p.path) || ".");
      } else {
        const path = (p.parent === "." ? "" : p.parent + "/") + name;
        await api.post(p.kind === "file" ? "/api/fs/create" : "/api/fs/mkdir", { path });
        await refreshDir(p.parent);
        if (p.kind === "file") openFile(path);
      }
    } catch (e: any) { toast(e.message, "error"); }
  };

  const del = async (node: TreeNode) => {
    if (!confirm(`Are you sure you want to delete '${node.name}'?`)) return;
    await api.post("/api/fs/delete", { path: node.path });
    closeTab(node.path, true);
    refreshDir(dirname(node.path) || ".");
  };

  return (
    <div className="explorer" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: null }); }}>
      <div className="section-header">
        <span className="section-title"><Icon name="chevron-down" /> {ws?.name.toUpperCase()}</span>
        <span className="section-actions">
          <IconButton icon="new-file" title="New File..." onClick={() => startCreate("file")} />
          <IconButton icon="new-folder" title="New Folder..." onClick={() => startCreate("dir")} />
          <IconButton icon="refresh" title="Refresh Explorer" onClick={() => { for (const d of Object.keys(getState().tree)) refreshDir(d); }} />
          <IconButton icon="collapse-all" title="Collapse Folders in Explorer" onClick={() => setState({ expanded: {} })} />
        </span>
      </div>
      <div className="tree" tabIndex={0}>
        {pending && pending.kind !== "rename" && pending.parent === "." && <NameInput depth={0} kind={pending.kind} onDone={commit} />}
        {root ? root.map((n) => <TreeItem key={n.path} node={n} depth={0} pending={pending} onCommit={commit} onMenu={(e, node) => { e.preventDefault(); e.stopPropagation(); setState({ selectedPath: node.path }); setMenu({ x: e.clientX, y: e.clientY, node }); }} />) : <div className="tree-empty"><Spinner /></div>}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: "New File...", run: () => startCreate("file", menu.node ? (menu.node.type === "dir" ? menu.node.path : dirname(menu.node.path) || ".") : ".") },
          { label: "New Folder...", run: () => startCreate("dir", menu.node ? (menu.node.type === "dir" ? menu.node.path : dirname(menu.node.path) || ".") : ".") },
          ...(menu.node ? [
            "sep" as const,
            ...(menu.node.type === "file" ? [{ label: "Add File to Chat", keys: "", run: () => addFileToChat(menu.node!.path) }] : []),
            { label: "Copy Path", run: () => navigator.clipboard.writeText(`${getState().workspace?.root}/${menu.node!.path}`) },
            { label: "Copy Relative Path", run: () => navigator.clipboard.writeText(menu.node!.path) },
            "sep" as const,
            { label: "Rename...", keys: "↵", run: () => setPending({ kind: "rename", path: menu.node!.path }) },
            { label: "Delete", keys: "⌘⌫", danger: true, run: () => del(menu.node!) },
          ] : []),
        ]} />
      )}
    </div>
  );
}

export async function addFileToChat(path: string) {
  const r = await api.get(`/api/fs/read?${api.q({ path })}`);
  addChip({ kind: "file", label: basename(path), path, content: r.content });
  focusAgent();
}

function TreeItem({ node, depth, pending, onCommit, onMenu }: { node: TreeNode; depth: number; pending: Pending; onCommit: (n: string) => void; onMenu: (e: React.MouseEvent, n: TreeNode) => void }) {
  const expanded = useStore((s) => !!s.expanded[node.path]);
  const children = useStore((s) => s.tree[node.path]);
  const selected = useStore((s) => s.selectedPath === node.path);
  const active = useStore((s) => s.activeTab === node.path);
  const dirty = useStore((s) => !!s.dirty[node.path]);
  const gitStatus = useStore((s) => s.git.files.find((f) => f.path === node.path || (node.type === "dir" && f.path.startsWith(node.path + "/")))?.status);
  const renaming = pending?.kind === "rename" && pending.path === node.path;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);

  const gitClass = gitStatus === "??" || gitStatus === "A" ? "git-added" : gitStatus === "M" ? "git-modified" : gitStatus === "D" ? "git-deleted" : "";
  return (
    <>
      {renaming ? <NameInput depth={depth} kind={node.type} initial={node.name} onDone={onCommit} /> : (
        <div
          ref={ref}
          className={`tree-item ${selected ? "selected" : ""} ${active ? "active" : ""} ${gitClass}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (node.type === "dir" ? toggleDir(node.path) : openFile(node.path, { preview: true }))}
          onDoubleClick={() => node.type === "file" && openFile(node.path)}
          onContextMenu={(e) => onMenu(e, node)}
          draggable={node.type === "file"}
          onDragStart={(e) => e.dataTransfer.setData("spacebar/path", node.path)}
        >
          {depth > 0 && Array.from({ length: depth }).map((_, i) => <span key={i} className="indent-guide" style={{ left: 14 + i * 12 }} />)}
          {node.type === "dir" ? <Icon name={expanded ? "chevron-down" : "chevron-right"} className="twistie" /> : <span className="twistie" />}
          {node.type === "dir" ? <Icon name={expanded ? "folder-opened" : "folder"} className="folder-icon" /> : <FileIcon name={node.name} />}
          <span className="tree-label">{node.name}</span>
          {dirty && <span className="dirty-dot" />}
          {gitStatus && node.type === "file" && <span className="git-letter">{gitStatus === "??" ? "U" : gitStatus}</span>}
          {gitStatus && node.type === "dir" && <span className="git-dot" />}
        </div>
      )}
      {node.type === "dir" && expanded && (
        <>
          {pending && pending.kind !== "rename" && pending.parent === node.path && <NameInput depth={depth + 1} kind={pending.kind} onDone={onCommit} />}
          {children?.map((c) => <TreeItem key={c.path} node={c} depth={depth + 1} pending={pending} onCommit={onCommit} onMenu={onMenu} />)}
        </>
      )}
    </>
  );
}

function NameInput({ depth, kind, initial = "", onDone }: { depth: number; kind: "file" | "dir"; initial?: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  return (
    <div className="tree-item editing" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="twistie" />
      {kind === "dir" ? <Icon name="folder" className="folder-icon" /> : <FileIcon name={initial || "file"} />}
      <input ref={ref} className="tree-input" defaultValue={initial}
        onKeyDown={(e) => { if (e.key === "Enter") onDone(e.currentTarget.value); if (e.key === "Escape") onDone(""); }}
        onBlur={(e) => onDone(e.currentTarget.value)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SearchView() {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState({ regex: false, case: false });
  const [glob, setGlob] = useState("");
  const [hits, setHits] = useState<{ path: string; line: number; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!q) { setHits([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { setHits(await api.get(`/api/search?${api.q({ q, regex: opts.regex ? 1 : "", case: opts.case ? 1 : "", glob })}`)); } catch { setHits([]); }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, opts, glob]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof hits>();
    for (const h of hits) { if (!m.has(h.path)) m.set(h.path, []); m.get(h.path)!.push(h); }
    return [...m.entries()];
  }, [hits]);

  const highlight = (text: string) => {
    if (!q) return text;
    try {
      const re = new RegExp(opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.case ? "g" : "gi");
      const out: React.ReactNode[] = [];
      let last = 0, m: RegExpExecArray | null, i = 0;
      while ((m = re.exec(text)) && i++ < 20) { if (!m[0]) break; out.push(text.slice(last, m.index), <mark key={i}>{m[0]}</mark>); last = m.index + m[0].length; }
      out.push(text.slice(last));
      return out;
    } catch { return text; }
  };

  return (
    <div className="search-view">
      <div className="section-header"><span className="section-title">SEARCH</span></div>
      <div className="search-box">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" spellCheck={false} />
        <IconButton icon="case-sensitive" title="Match Case" active={opts.case} onClick={() => setOpts((o) => ({ ...o, case: !o.case }))} />
        <IconButton icon="regex" title="Use Regular Expression" active={opts.regex} onClick={() => setOpts((o) => ({ ...o, regex: !o.regex }))} />
      </div>
      <div className="search-box small"><input value={glob} onChange={(e) => setGlob(e.target.value)} placeholder="files to include (e.g. *.ts)" spellCheck={false} /></div>
      {q && <div className="search-summary">{loading ? <Spinner /> : `${hits.length}${hits.length >= 500 ? "+" : ""} results in ${grouped.length} files`}</div>}
      <div className="search-results">
        {grouped.map(([path, hs]) => (
          <div key={path}>
            <div className="search-file" onClick={() => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}>
              <Icon name={collapsed[path] ? "chevron-right" : "chevron-down"} className="twistie" />
              <FileIcon name={basename(path)} />
              <span className="tree-label">{basename(path)}</span>
              <span className="search-dir">{dirname(path)}</span>
              <span className="count-badge">{hs.length}</span>
            </div>
            {!collapsed[path] && hs.map((h, i) => (
              <div key={i} className="search-hit" onClick={() => openFile(h.path, { line: h.line, preview: true })} title={`${h.path}:${h.line}`}>
                {highlight(h.text.trim().slice(0, 200))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ScmView() {
  const git = useStore((s) => s.git);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"" | "gen" | "commit">("");
  useEffect(() => { refreshGit(); }, []);

  if (!git.repo) {
    return (
      <div className="scm-view">
        <div className="section-header"><span className="section-title">SOURCE CONTROL</span></div>
        <div className="empty-hint">
          <p>The folder currently open doesn't have a git repository.</p>
          <button className="btn primary" onClick={async () => { await api.post("/api/git/init"); refreshGit(); }}>Initialize Repository</button>
        </div>
      </div>
    );
  }
  const generate = async () => {
    setBusy("gen");
    try { setMsg((await api.post("/api/git/commit-message")).message); } catch (e: any) { toast(e.message, "error"); }
    setBusy("");
  };
  const commit = async () => {
    if (!msg.trim()) return generate();
    setBusy("commit");
    try { await api.post("/api/git/commit", { message: msg }); setMsg(""); refreshGit(); toast("Committed"); } catch (e: any) { toast(e.message, "error"); }
    setBusy("");
  };
  const label = (s: string) => (s === "??" ? "U" : s);
  return (
    <div className="scm-view">
      <div className="section-header">
        <span className="section-title">SOURCE CONTROL</span>
        <span className="section-actions"><IconButton icon="refresh" title="Refresh" onClick={refreshGit} /></span>
      </div>
      <div className="scm-commit">
        <div className="scm-input-wrap">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Message (⌘⏎ to commit on "${git.branch}")`} rows={msg.split("\n").length > 1 ? 4 : 1}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") commit(); }} />
          <button className="sparkle-btn" title="Generate Commit Message" onClick={generate} disabled={!!busy}>{busy === "gen" ? <Spinner /> : <Icon name="sparkle" />}</button>
        </div>
        <button className="btn primary block" onClick={commit} disabled={!!busy || !git.files.length}><Icon name="check" /> Commit</button>
      </div>
      <div className="section-subheader">Changes <span className="count-badge">{git.files.length}</span></div>
      {git.files.map((f) => (
        <div key={f.path} className={`tree-item scm-file git-${f.status === "??" || f.status === "A" ? "added" : f.status === "D" ? "deleted" : "modified"}`}
          onClick={async () => {
            if (f.status === "D") return;
            const orig = f.status === "??" || f.status === "A" ? "" : (await api.get(`/api/git/original?${api.q({ path: f.path })}`)).content;
            openDiff(f.path, orig, "git");
          }}>
          <FileIcon name={basename(f.path)} />
          <span className="tree-label">{basename(f.path)}</span>
          <span className="search-dir">{dirname(f.path)}</span>
          <span className="git-letter">{label(f.status)}</span>
        </div>
      ))}
    </div>
  );
}

export { revealInExplorer };
