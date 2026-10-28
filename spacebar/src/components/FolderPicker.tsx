import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { openFolder } from "../lib/actions";
import { setState, useStore } from "../lib/store";
import { Icon } from "./small";

export function FolderPicker() {
  const recent = useStore((s) => s.settings?.recentWorkspaces ?? s.workspace?.recent ?? []);
  const [path, setPath] = useState("");
  const [data, setData] = useState<{ path: string; parent: string; dirs: string[] } | null>(null);
  const load = async (p?: string) => { const d = await api.get(`/api/browse?${api.q({ path: p })}`); setData(d); setPath(d.path); };
  useEffect(() => { load(); }, []);
  const close = () => setState({ folderPickerOpen: false });
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal folder-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Open Folder</div>
        <div className="folder-path">
          <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(path); }} spellCheck={false} />
          <button className="btn primary" onClick={() => openFolder(path)}>Open</button>
        </div>
        <div className="folder-list">
          {data && data.path !== data.parent && <div className="folder-row" onClick={() => load(data.parent)}><Icon name="arrow-up" /> ..</div>}
          {data?.dirs.map((d) => (
            <div key={d} className="folder-row" onClick={() => load(`${data.path}/${d}`)} onDoubleClick={() => openFolder(`${data.path}/${d}`)}>
              <Icon name="folder" /> {d}
            </div>
          ))}
        </div>
        {recent.length > 0 && (
          <>
            <div className="menu-group">Recent</div>
            {recent.slice(0, 5).map((r: string) => <div key={r} className="folder-row" onClick={() => openFolder(r)}><Icon name="history" /> {r}</div>)}
          </>
        )}
        <div className="modal-footer"><button className="btn ghost" onClick={close}>Cancel</button></div>
      </div>
    </div>
  );
}
