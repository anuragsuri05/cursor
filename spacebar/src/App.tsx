import { useEffect } from "react";
import { socket } from "./lib/api";
import {
  activeEditor, closeTab, createChat, focusAgent, handleSocketMessage, loadModels, loadSettings, loadWorkspace,
  openSettings, saveAll, saveFile, toggleAgent, togglePanel, toggleSidebar,
} from "./lib/actions";
import { getState, setState, useStore } from "./lib/store";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { EditorArea } from "./components/EditorArea";
import { Panel } from "./components/Panel";
import { AgentPanel } from "./components/AgentPanel";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsModal } from "./components/Settings";
import { FolderPicker } from "./components/FolderPicker";
import { Welcome } from "./components/Welcome";
import { Resizer } from "./components/Resizer";
import { Toasts } from "./components/Toasts";

export function App() {
  const s = useStore((s) => s);

  useEffect(() => {
    const off = socket.on(handleSocketMessage);
    setState({ connected: socket.connected });
    // "Run in terminal" requests: open the panel first, then hand the command to the (now mounted) terminal.
    const runReq = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.__forwarded || getState().panelVisible) return;
      setState({ panelVisible: true, panelView: "terminal" });
      setTimeout(() => window.dispatchEvent(new CustomEvent("spacebar:run-in-terminal", { detail: Object.assign(new String(ev.detail), { __forwarded: true }) })), 1500);
    };
    window.addEventListener("spacebar:run-in-terminal", runReq);
    loadWorkspace().catch(() => {});
    loadSettings().then(() => loadModels()).catch(() => {});
    return () => { off(); window.removeEventListener("spacebar:run-in-terminal", runReq); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const inEditor = !!(document.activeElement as HTMLElement)?.closest?.(".monaco-editor");
      if (mod && e.shiftKey && k === "p") { e.preventDefault(); setState({ palette: "commands" }); }
      else if (mod && !e.shiftKey && k === "p") { e.preventDefault(); setState({ palette: "files" }); }
      else if (mod && k === "b" && !e.shiftKey) { e.preventDefault(); toggleSidebar(); }
      else if (mod && k === "j" && !e.shiftKey) { e.preventDefault(); togglePanel(); }
      else if (mod && e.shiftKey && k === "j") { e.preventDefault(); openSettings("general"); }
      else if (mod && k === "`") { e.preventDefault(); setState((st) => ({ panelVisible: !st.panelVisible || st.panelView !== "terminal", panelView: "terminal" })); }
      else if (mod && k === "," ) { e.preventDefault(); openSettings("general"); }
      else if (mod && (k === "i" || k === "l") && !e.shiftKey && !e.altKey) {
        // Cmd+L with a selection adds it to chat (handled by the editor); otherwise toggle/focus the agent.
        if (k === "l" && inEditor && activeEditor && !activeEditor.getSelection()?.isEmpty()) return;
        e.preventDefault();
        const st = getState();
        const focused = !!(document.activeElement as HTMLElement)?.closest?.(".agent");
        if (st.agentVisible && focused) toggleAgent(); else focusAgent();
      }
      else if (mod && k === "e" && !e.shiftKey) { e.preventDefault(); setState((st) => ({ agentMaximized: !st.agentMaximized, agentVisible: true })); }
      else if (mod && k === "n" && !e.shiftKey && (document.activeElement as HTMLElement)?.closest?.(".agent")) { e.preventDefault(); createChat(); }
      else if (mod && e.shiftKey && k === "e") { e.preventDefault(); setState({ sidebarVisible: true, sidebarView: "explorer" }); }
      else if (mod && e.shiftKey && k === "f") { e.preventDefault(); setState({ sidebarVisible: true, sidebarView: "search" }); }
      else if (e.ctrlKey && e.shiftKey && k === "g") { e.preventDefault(); setState({ sidebarVisible: true, sidebarView: "scm" }); }
      else if (mod && k === "s") { e.preventDefault(); if (e.altKey) saveAll(); else saveFile(); }
      else if (mod && k === "w" && !e.shiftKey) { const t = getState().activeTab; if (t) { e.preventDefault(); closeTab(t); } }
      else if (mod && k === "o" && !e.shiftKey) { e.preventDefault(); setState({ folderPickerOpen: true }); }
      else if (e.key === "Escape" && getState().palette) setState({ palette: null });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const showEditor = !s.agentMaximized;

  return (
    <div className="app">
      <TitleBar />
      <div className="main">
        {s.workspace ? (
          <>
            {s.sidebarVisible && showEditor && (
              <>
                <div className="sidebar" style={{ width: s.sidebarWidth }}><Sidebar /></div>
                <Resizer dir="x" onDrag={(dx) => setState((st) => ({ sidebarWidth: Math.max(170, Math.min(600, st.sidebarWidth + dx)) }))} />
              </>
            )}
            {showEditor && (
              <div className="center">
                <EditorArea />
                {s.panelVisible && (
                  <>
                    <Resizer dir="y" onDrag={(_, dy) => setState((st) => ({ panelHeight: Math.max(100, Math.min(window.innerHeight - 200, st.panelHeight - dy)) }))} />
                    <div className="panel" style={{ height: s.panelHeight }}><Panel /></div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          showEditor && <Welcome />
        )}
        {s.agentVisible && (
          <>
            {showEditor && <Resizer dir="x" onDrag={(dx) => setState((st) => ({ agentWidth: Math.max(320, Math.min(900, st.agentWidth - dx)) }))} />}
            <div className={`agent ${s.agentMaximized ? "maximized" : ""}`} style={showEditor ? { width: s.agentWidth } : undefined}><AgentPanel /></div>
          </>
        )}
      </div>
      <StatusBar />
      {s.palette && <CommandPalette />}
      {s.settingsOpen && <SettingsModal />}
      {s.folderPickerOpen && <FolderPicker />}
      <Toasts />
    </div>
  );
}
