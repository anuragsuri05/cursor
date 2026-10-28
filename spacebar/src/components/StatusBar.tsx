import { openSettings, saveSettings } from "../lib/actions";
import { setState, useStore } from "../lib/store";
import { Icon } from "./small";

export function StatusBar() {
  const git = useStore((s) => s.git);
  const cursor = useStore((s) => s.cursor);
  const markers = useStore((s) => s.markers);
  const connected = useStore((s) => s.connected);
  const tab = useStore((s) => s.settings?.tabEnabled);
  const ws = useStore((s) => s.workspace);
  const hasFile = useStore((s) => !!s.activeTab && !s.activeTab.startsWith("diff:"));
  return (
    <div className="statusbar">
      <div className="status-left">
        {!connected && <span className="status-item warn"><Icon name="debug-disconnect" /> Disconnected</span>}
        {git.repo && <span className="status-item" onClick={() => setState({ sidebarVisible: true, sidebarView: "scm" })}><Icon name="source-control" /> {git.branch}{git.files.length ? "*" : ""}</span>}
        {ws && (
          <span className="status-item" onClick={() => setState({ panelVisible: true, panelView: "problems" })}>
            <Icon name="error" /> {markers.errors} <Icon name="warning" /> {markers.warnings}
          </span>
        )}
      </div>
      <div className="status-right">
        {hasFile && (
          <>
            <span className="status-item">Ln {cursor.line}, Col {cursor.col}{cursor.selection ? ` (${cursor.selection} selected)` : ""}</span>
            <span className="status-item">Spaces: 2</span>
            <span className="status-item">UTF-8</span>
            <span className="status-item">{cursor.language}</span>
          </>
        )}
        <span className="status-item" title="Toggle Spacebar Tab (AI autocomplete)" onClick={() => saveSettings({ tabEnabled: !tab })}>
          <Icon name={tab ? "check" : "circle-slash"} /> Spacebar Tab
        </span>
        <span className="status-item" onClick={() => openSettings("models")}><Icon name="sparkle" /></span>
        <span className="status-item"><Icon name="bell" /></span>
      </div>
    </div>
  );
}
