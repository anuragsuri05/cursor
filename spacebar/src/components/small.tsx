import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { setState, useStore } from "../lib/store";

export const Icon = ({ name, className = "", title, onClick, size }: { name: string; className?: string; title?: string; onClick?: (e: React.MouseEvent) => void; size?: number }) =>
  // Cursor's Agent mode uses ∞, which codicons don't include.
  name === "infinity" ? <i className={`codicon glyph-infinity ${className}`} title={title} onClick={onClick}>∞</i> : (
  <i className={`codicon codicon-${name} ${className}`} title={title} onClick={onClick} style={size ? { fontSize: size } : undefined} />
);

export function IconButton({ icon, title, onClick, active, className = "", disabled }: { icon: string; title?: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; className?: string; disabled?: boolean }) {
  return (
    <button className={`icon-btn ${active ? "active" : ""} ${className}`} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <span className="kbd">{children}</span>; }

/** Popover menu anchored to its trigger; closes on outside click / Escape. */
export function Popover({ open, onClose, children, className = "", style }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open, onClose]);
  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const dx = r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : r.left < 8 ? 8 - r.left : 0;
    if (dx) el.style.translate = `${dx}px 0`;
  }, [open]);
  if (!open) return null;
  return <div ref={ref} className={`popover ${className}`} style={style}>{children}</div>;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ({ label: string; keys?: string; run: () => void; danger?: boolean } | "sep")[]; onClose: () => void }) {
  return (
    <Popover open onClose={onClose} className="context-menu" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - items.length * 26 - 20), position: "fixed" }}>
      {items.map((it, i) => it === "sep" ? <div key={i} className="menu-sep" /> : (
        <div key={i} className={`menu-item ${it.danger ? "danger" : ""}`} onClick={() => { onClose(); it.run(); }}>
          <span>{it.label}</span>{it.keys && <span className="menu-keys">{it.keys}</span>}
        </div>
      ))}
    </Popover>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}><span /></button>;
}

export function Spinner() { return <span className="spinner" />; }

export function fileIcon(name: string): { icon: string; color: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, [string, string]> = {
    ts: ["file-code", "#3b8eea"], tsx: ["file-code", "#4fc1ff"], js: ["file-code", "#e8d44d"], jsx: ["file-code", "#61dafb"], mjs: ["file-code", "#e8d44d"], cjs: ["file-code", "#e8d44d"],
    json: ["json", "#cbcb41"], md: ["markdown", "#7aa6da"], mdc: ["markdown", "#a6a6ff"], css: ["symbol-color", "#56b3f4"], scss: ["symbol-color", "#f55385"], html: ["code", "#e44d26"],
    py: ["file-code", "#4b8bbe"], go: ["file-code", "#00add8"], rs: ["file-code", "#dea584"], java: ["file-code", "#e76f00"], rb: ["ruby", "#cc342d"], php: ["file-code", "#8892bf"],
    c: ["file-code", "#5c9fd6"], h: ["file-code", "#a074c4"], cpp: ["file-code", "#f34b7d"], cs: ["file-code", "#68217a"], swift: ["file-code", "#f05138"], kt: ["file-code", "#a97bff"],
    sh: ["terminal", "#89e051"], zsh: ["terminal", "#89e051"], yml: ["settings", "#cb171e"], yaml: ["settings", "#cb171e"], toml: ["settings", "#9c4221"], env: ["key", "#e5c07b"],
    png: ["file-media", "#a074c4"], jpg: ["file-media", "#a074c4"], svg: ["file-media", "#ffb13b"], gif: ["file-media", "#a074c4"], lock: ["lock", "#8a8a8a"], txt: ["file", "#8a8a8a"],
    sql: ["database", "#e38c00"], vue: ["file-code", "#41b883"], svelte: ["file-code", "#ff3e00"], dockerfile: ["file", "#2496ed"],
  };
  if (name === "package.json") return { icon: "package", color: "#e8274b" };
  if (name.startsWith(".git")) return { icon: "source-control", color: "#f14e32" };
  if (/^dockerfile/i.test(name)) return { icon: "file", color: "#2496ed" };
  const m = map[ext];
  return m ? { icon: m[0], color: m[1] } : { icon: "file", color: "#9a9a9a" };
}

export function FileIcon({ name }: { name: string }) {
  const { icon, color } = fileIcon(name);
  return <i className={`codicon codicon-${icon} file-icon`} style={{ color }} />;
}

export function useConnected() { return useStore((s) => s.connected); }
export const closeOverlays = () => setState({ palette: null, settingsOpen: false, folderPickerOpen: false });
