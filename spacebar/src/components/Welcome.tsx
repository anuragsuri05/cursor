import { openFolder, openSettings } from "../lib/actions";
import { basename, MOD, setState, useStore } from "../lib/store";
import { Icon } from "./small";

export function Welcome() {
  const recent: string[] = useStore((s) => s.settings?.recentWorkspaces ?? []);
  const models = useStore((s) => s.models.length);
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <svg viewBox="0 0 32 32" width="56" height="56"><rect x="2" y="10" width="28" height="12" rx="3.5" fill="currentColor" /><rect x="9" y="17" width="14" height="2" rx="1" fill="#141414" opacity="0.55" /></svg>
          <div>
            <div className="welcome-name">Spacebar</div>
            <div className="welcome-sub">The AI code editor built on free models</div>
          </div>
        </div>
        <div className="welcome-actions">
          <button className="welcome-card" onClick={() => setState({ folderPickerOpen: true })}>
            <Icon name="folder-opened" /><span>Open project</span><span className="kbd">{MOD}O</span>
          </button>
          <button className="welcome-card" onClick={() => openSettings("models")}>
            <Icon name="sparkle" /><span>{models ? `${models} models connected` : "Connect free models"}</span>
          </button>
          <button className="welcome-card" onClick={() => setState({ agentVisible: true, focusComposer: Date.now() })}>
            <Icon name="comment-discussion" /><span>Open Agent</span><span className="kbd">{MOD}I</span>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-title">Recent projects</div>
            {recent.slice(0, 6).map((r) => (
              <div key={r} className="welcome-recent-row" onClick={() => openFolder(r)}>
                <span className="welcome-recent-name">{basename(r)}</span>
                <span className="welcome-recent-path">{r}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
