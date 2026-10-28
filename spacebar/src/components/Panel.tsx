import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import * as monaco from "monaco-editor";
import { socket } from "../lib/api";
import { focusAgent, openFile } from "../lib/actions";
import { basename, setState, useStore } from "../lib/store";
import { addChip } from "./AgentPanel";
import { Icon, IconButton } from "./small";

interface TermInfo { id: string; title: string }

const terms = new Map<string, { term: Terminal; fit: FitAddon; el: HTMLDivElement }>();
let counter = 0;

export function Panel() {
  const view = useStore((s) => s.panelView);
  const markers = useStore((s) => s.markers);
  const [list, setList] = useState<TermInfo[]>([]);
  const [active, setActive] = useState<string>("");

  const newTerm = () => {
    const id = `t${++counter}_${Date.now()}`;
    setList((l) => [...l, { id, title: "zsh" }]);
    setActive(id);
    setState({ panelView: "terminal" });
    return id;
  };

  useEffect(() => { if (!list.length) newTerm(); }, []);
  useEffect(() => {
    const off = socket.on((m) => {
      if (m.type === "term.exit") {
        setList((l) => { const n = l.filter((t) => t.id !== m.id); return n; });
        terms.get(m.id)?.term.dispose(); terms.delete(m.id);
      }
    });
    const run = (e: Event) => {
      const cmd = String((e as CustomEvent).detail);
      setState({ panelVisible: true, panelView: "terminal" });
      const id = active || [...terms.keys()][0];
      if (id) socket.send({ type: "term.input", id, data: cmd.replace(/\n+$/, "") + "\r" });
    };
    window.addEventListener("spacebar:run-in-terminal", run);
    return () => { off(); window.removeEventListener("spacebar:run-in-terminal", run); };
  }, [active]);
  useEffect(() => { if (list.length && !list.some((t) => t.id === active)) setActive(list[list.length - 1].id); }, [list]);

  const kill = (id: string) => { socket.send({ type: "term.kill", id }); terms.get(id)?.term.dispose(); terms.delete(id); setList((l) => l.filter((t) => t.id !== id)); };

  return (
    <div className="panel-inner">
      <div className="panel-header">
        <div className="panel-tabs">
          <button className={`panel-tab ${view === "problems" ? "active" : ""}`} onClick={() => setState({ panelView: "problems" })}>Problems {markers.errors + markers.warnings > 0 && <span className="count-badge">{markers.errors + markers.warnings}</span>}</button>
          <button className={`panel-tab ${view === "output" ? "active" : ""}`} onClick={() => setState({ panelView: "output" })}>Output</button>
          <button className={`panel-tab ${view === "terminal" ? "active" : ""}`} onClick={() => setState({ panelView: "terminal" })}>Terminal</button>
        </div>
        <div className="panel-actions">
          {view === "terminal" && (
            <>
              {list.length > 1 && (
                <select className="term-select" value={active} onChange={(e) => setActive(e.target.value)}>
                  {list.map((t, i) => <option key={t.id} value={t.id}>{i + 1}: {t.title}</option>)}
                </select>
              )}
              <IconButton icon="add" title="New Terminal" onClick={newTerm} />
              <IconButton icon="comment-discussion" title="Add Terminal Output to Chat" onClick={() => {
                const t = terms.get(active)?.term;
                if (!t) return;
                const buf = t.buffer.active;
                const lines: string[] = [];
                for (let i = Math.max(0, buf.length - 200); i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
                addChip({ kind: "terminal", label: "Terminal", content: lines.join("\n").trim() });
                focusAgent();
              }} />
              <IconButton icon="trash" title="Kill Terminal" onClick={() => active && kill(active)} />
            </>
          )}
          <IconButton icon="chevron-up" title="Maximize Panel Size" onClick={() => setState((s) => ({ panelHeight: s.panelHeight > window.innerHeight / 2 ? 260 : window.innerHeight - 220 }))} />
          <IconButton icon="close" title="Close Panel" onClick={() => setState({ panelVisible: false })} />
        </div>
      </div>
      <div className="panel-body">
        {list.map((t) => <TerminalView key={t.id} id={t.id} visible={view === "terminal" && t.id === active} />)}
        {view === "terminal" && !list.length && <div className="empty-hint"><button className="btn" onClick={newTerm}>New Terminal</button></div>}
        {view === "problems" && <Problems />}
        {view === "output" && <div className="output-view">Spacebar server logs appear in the terminal where you ran <code>npm run dev</code>.</div>}
      </div>
    </div>
  );
}

function TerminalView({ id, visible }: { id: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let entry = terms.get(id);
    if (!entry) {
      const term = new Terminal({
        fontFamily: "Menlo, Monaco, 'SF Mono', monospace", fontSize: 12, lineHeight: 1.2, cursorBlink: true, allowProposedApi: true,
        theme: { background: "#141414", foreground: "#d6d6dd", cursor: "#d6d6dd", selectionBackground: "#40404099", black: "#1e1e1e", brightBlack: "#5a5a5a", red: "#f14c4c", green: "#3fb950", yellow: "#e5c07b", blue: "#4ea1ff", magenta: "#c678dd", cyan: "#56b6c2", white: "#d6d6dd" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      const el = document.createElement("div");
      el.className = "xterm-host";
      term.open(el);
      term.onData((data) => socket.send({ type: "term.input", id, data }));
      term.onResize(({ cols, rows }) => socket.send({ type: "term.resize", id, cols, rows }));
      socket.on((m) => { if (m.type === "term.data" && m.id === id) term.write(m.data); });
      entry = { term, fit, el };
      terms.set(id, entry);
      requestAnimationFrame(() => { try { fit.fit(); } catch { /* hidden */ } socket.send({ type: "term.create", id, cols: term.cols, rows: term.rows }); });
    }
    host.current!.appendChild(entry.el);
    const ro = new ResizeObserver(() => { try { entry!.fit.fit(); } catch { /* hidden */ } });
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, [id]);
  useEffect(() => { if (visible) { const e = terms.get(id); requestAnimationFrame(() => { try { e?.fit.fit(); } catch { /* hidden */ } e?.term.focus(); }); } }, [visible]);
  return <div ref={host} className="term-container" style={{ display: visible ? "block" : "none" }} />;
}

function Problems() {
  useStore((s) => s.markers);
  const markers = monaco.editor.getModelMarkers({}).filter((m) => m.resource.scheme === "file");
  if (!markers.length) return <div className="output-view">No problems have been detected in the workspace.</div>;
  return (
    <div className="problems">
      {markers.map((m, i) => (
        <div key={i} className="problem-row" onClick={() => openFile(m.resource.path.slice(1), { line: m.startLineNumber, col: m.startColumn })}>
          <Icon name={m.severity === monaco.MarkerSeverity.Error ? "error" : "warning"} className={m.severity === monaco.MarkerSeverity.Error ? "err" : "warn"} />
          <span className="problem-msg">{m.message}</span>
          <span className="search-dir">{basename(m.resource.path)} [Ln {m.startLineNumber}, Col {m.startColumn}]</span>
        </div>
      ))}
    </div>
  );
}
