import { openSettings, toggleAgent, togglePanel, toggleSidebar } from "../lib/actions";
import { MOD, setState, useStore } from "../lib/store";
import { IconButton } from "./small";

export function TitleBar() {
  const ws = useStore((s) => s.workspace);
  const sidebar = useStore((s) => s.sidebarVisible);
  const panel = useStore((s) => s.panelVisible);
  const agent = useStore((s) => s.agentVisible);
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="traffic-space" />
        <IconButton icon="layout-sidebar-left" title={`Toggle Primary Side Bar (${MOD}B)`} onClick={toggleSidebar} active={sidebar} />
        <IconButton icon="arrow-left" title="Go Back" />
        <IconButton icon="arrow-right" title="Go Forward" />
      </div>
      <div className="titlebar-search" onClick={() => setState({ palette: "files" })}>
        <span className="codicon codicon-search" />
        <span>{ws ? ws.name : "Spacebar"}</span>
      </div>
      <div className="titlebar-right">
        <IconButton icon="layout-panel" title={`Toggle Panel (${MOD}J)`} onClick={togglePanel} active={panel} />
        <IconButton icon="layout-sidebar-right" title={`Toggle Agent (${MOD}I)`} onClick={toggleAgent} active={agent} />
        <IconButton icon="settings-gear" title="Spacebar Settings" onClick={() => openSettings("general")} />
      </div>
    </div>
  );
}
