import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { closeTab, ensureModel, focusAgent, keepChanges, modelFor, openFile, revealInExplorer, saveFile, setActiveEditor, undoChanges, uriFor } from "../lib/actions";
import { basename, getState, MOD, setState, useStore, type Tab } from "../lib/store";
import { addChip } from "./AgentPanel";
import { InlineEditController } from "./InlineEdit";
import { FileIcon, Icon, IconButton } from "./small";

const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "spacebar-dark",
  fontFamily: "Menlo, Monaco, 'SF Mono', 'JetBrains Mono', Consolas, monospace",
  fontSize: 13,
  lineHeight: 19,
  automaticLayout: true,
  minimap: { enabled: true, renderCharacters: false, maxColumn: 80, scale: 1 },
  scrollBeyondLastLine: true,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  renderLineHighlight: "line",
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, bracketPairs: false },
  inlineSuggest: { enabled: true, showToolbar: "onHover" },
  stickyScroll: { enabled: true },
  padding: { top: 4 },
  tabSize: 2,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  fixedOverflowWidgets: true,
};

export function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const activeTab = tabs.find((t) => t.path === active);
  return (
    <div className="editor-area">
      {tabs.length > 0 && <TabBar />}
      {activeTab && <Breadcrumbs tab={activeTab} />}
      <div className="editor-body">
        <CodeEditor hidden={!activeTab || activeTab.kind !== "file"} />
        {activeTab?.kind === "diff" && <DiffView key={activeTab.path} tab={activeTab} />}
        {!activeTab && <EmptyEditor />}
      </div>
    </div>
  );
}

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const dirty = useStore((s) => s.dirty);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active]);
  return (
    <div className="tabbar" ref={ref} onWheel={(e) => { if (ref.current) ref.current.scrollLeft += e.deltaY; }}>
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab ${t.path === active ? "active" : ""} ${t.preview ? "preview" : ""} ${dirty[t.path] ? "dirty" : ""}`}
          onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } else setState({ activeTab: t.path }); }}
          onDoubleClick={() => setState((s) => ({ tabs: s.tabs.map((x) => (x.path === t.path ? { ...x, preview: false } : x)) }))}
          title={t.kind === "diff" ? `${t.diff?.file} (Changes)` : t.path}
        >
          {t.kind === "diff" ? <Icon name="diff" className="file-icon" /> : <FileIcon name={t.title} />}
          <span className="tab-label">{t.title}{t.kind === "diff" && <span className="tab-desc"> {t.diff?.source === "git" ? "(Working Tree)" : "(Review)"}</span>}</span>
          <span className="tab-close" onMouseDown={(e) => { e.stopPropagation(); closeTab(t.path); }}>
            <Icon name={dirty[t.path] ? "circle-filled" : "close"} className={dirty[t.path] ? "dirty-icon" : ""} />
          </span>
        </div>
      ))}
      <div className="tabbar-fill" />
    </div>
  );
}

function Breadcrumbs({ tab }: { tab: Tab }) {
  const file = tab.kind === "diff" ? tab.diff!.file : tab.path;
  const parts = file.split("/");
  return (
    <div className="breadcrumbs">
      {parts.map((p, i) => (
        <span key={i} className="crumb" onClick={() => revealInExplorer(parts.slice(0, i + 1).join("/"))}>
          {i === parts.length - 1 && <FileIcon name={p} />}
          {p}
          {i < parts.length - 1 && <Icon name="chevron-right" className="crumb-sep" />}
        </span>
      ))}
    </div>
  );
}

function CodeEditor({ hidden }: { hidden: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const active = useStore((s) => s.activeTab);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());

  useEffect(() => {
    const editor = monaco.editor.create(el.current!, { ...editorOptions, model: null });
    ed.current = editor;
    setActiveEditor(editor);
    new InlineEditController(editor);

    editor.addAction({
      id: "spacebar.addToChat", label: "Spacebar: Add Selection to Chat", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
      contextMenuGroupId: "0_spacebar", contextMenuOrder: 1,
      run: (e) => {
        const sel = e.getSelection(); const m = e.getModel();
        if (!sel || !m) return;
        if (sel.isEmpty()) { focusAgent(); return; }
        const path = m.uri.path.slice(1);
        addChip({ kind: "selection", label: `${basename(path)} (${sel.startLineNumber}-${sel.endLineNumber})`, path, content: m.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber });
        focusAgent();
      },
    });
    editor.addAction({ id: "spacebar.inlineEditMenu", label: "Spacebar: Edit with AI", contextMenuGroupId: "0_spacebar", contextMenuOrder: 2, run: (e) => e.getAction("spacebar.inlineEdit")?.run() });
    editor.addAction({ id: "spacebar.save", label: "Save", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => saveFile() });

    editor.onDidChangeCursorSelection((e) => {
      const m = editor.getModel();
      const sel = e.selection;
      setState({ cursor: { line: sel.positionLineNumber, col: sel.positionColumn, language: m?.getLanguageId() ?? "", selection: m && !sel.isEmpty() ? m.getValueInRange(sel).length : 0 } });
    });
    const markerSub = monaco.editor.onDidChangeMarkers(() => {
      const all = monaco.editor.getModelMarkers({});
      setState({ markers: { errors: all.filter((m) => m.severity === monaco.MarkerSeverity.Error).length, warnings: all.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length } });
    });
    // Drag files from the explorer into the editor to open them.
    el.current!.addEventListener("drop", (e) => { const p = e.dataTransfer?.getData("spacebar/path"); if (p) { e.preventDefault(); openFile(p); } });
    return () => { markerSub.dispose(); editor.dispose(); setActiveEditor(null); };
  }, []);

  useEffect(() => {
    const editor = ed.current;
    if (!editor || !active || active.startsWith("diff:")) return;
    (async () => {
      const prev = editor.getModel();
      if (prev) viewStates.current.set(prev.uri.path.slice(1), editor.saveViewState());
      const m = modelFor(active) ?? (await ensureModel(active));
      if (!m || getState().activeTab !== active) return;
      if (editor.getModel() !== m) {
        editor.setModel(m);
        const vs = viewStates.current.get(active);
        if (vs) editor.restoreViewState(vs);
        setState((s) => ({ cursor: { ...s.cursor, language: m.getLanguageId() } }));
      }
      setActiveEditor(editor);
      editor.focus();
    })();
  }, [active]);

  return <div ref={el} className="monaco-host" style={{ display: hidden ? "none" : "block" }} onDragOver={(e) => e.preventDefault()} />;
}

function DiffView({ tab }: { tab: Tab }) {
  const el = useRef<HTMLDivElement>(null);
  const d = tab.diff!;
  const chatChange = useStore((s) => (d.sessionId ? s.chats.find((c) => c.id === d.sessionId)?.changes.find((f) => f.path === d.file) : undefined));

  useEffect(() => {
    const diff = monaco.editor.createDiffEditor(el.current!, { ...editorOptions, renderSideBySide: false, readOnly: false, originalEditable: false, minimap: { enabled: false }, renderOverviewRuler: true });
    const lang = modelFor(d.file)?.getLanguageId();
    const original = monaco.editor.createModel(d.original, lang, monaco.Uri.parse(`spacebar-orig:/${d.file}?${Date.now()}`));
    const modified = d.modified != null ? monaco.editor.createModel(d.modified, lang, monaco.Uri.parse(`spacebar-mod:/${d.file}?${Date.now()}`)) : modelFor(d.file)!;
    diff.setModel({ original, modified });
    return () => { diff.dispose(); original.dispose(); if (d.modified != null) modified.dispose(); };
  }, [d.original, d.modified, d.file]);

  const applyProposed = async () => {
    const m = await ensureModel(d.file);
    if (m && d.modified != null) { m.pushEditOperations([], [{ range: m.getFullModelRange(), text: d.modified }], () => null); await saveFile(d.file); }
    closeTab(tab.path, true);
    openFile(d.file);
  };

  return (
    <div className="diff-wrap">
      <div className="diff-toolbar">
        <Icon name="diff" />
        <span>{d.source === "git" ? "Working tree changes" : d.source === "apply" ? "Proposed change" : "Agent changes"} — {d.file}</span>
        <span className="spacer" />
        {d.source === "agent" && d.sessionId && chatChange && (
          <>
            <button className="btn ghost sm" onClick={() => undoChanges(d.sessionId!, d.file)}>Undo <span className="kbd-inline">{MOD}⌫</span></button>
            <button className="btn primary sm" onClick={() => keepChanges(d.sessionId!, d.file)}>Keep <span className="kbd-inline">{MOD}⏎</span></button>
          </>
        )}
        {d.source === "apply" && (
          <>
            <button className="btn ghost sm" onClick={() => closeTab(tab.path, true)}>Reject</button>
            <button className="btn primary sm" onClick={applyProposed}>Accept</button>
          </>
        )}
        <IconButton icon="go-to-file" title="Open File" onClick={() => openFile(d.file)} />
      </div>
      <div ref={el} className="monaco-host" />
    </div>
  );
}

function EmptyEditor() {
  const rows: [string, string][] = [
    ["Open Agent", `${MOD}I`],
    ["Show All Commands", `⇧${MOD}P`],
    ["Go to File", `${MOD}P`],
    ["Edit Inline", `${MOD}K`],
    ["Toggle Terminal", `${MOD}J`],
    ["Open Settings", `⇧${MOD}J`],
  ];
  return (
    <div className="empty-editor">
      <div className="empty-logo">
        <svg viewBox="0 0 32 32" width="72" height="72"><rect x="2" y="10" width="28" height="12" rx="3.5" fill="currentColor" /><rect x="9" y="17" width="14" height="2" rx="1" fill="#141414" opacity="0.55" /></svg>
      </div>
      <div className="empty-shortcuts">
        {rows.map(([l, k]) => <div key={l} className="empty-row"><span>{l}</span><span className="kbd">{k}</span></div>)}
      </div>
    </div>
  );
}

export { uriFor };
