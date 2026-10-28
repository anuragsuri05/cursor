import { useMemo, useState } from "react";
import { openSettings } from "../lib/actions";
import { useStore, type ModelInfo } from "../lib/store";
import { Icon, Popover } from "./small";

export const ENSEMBLES = [
  { id: "ensemble/max", name: "Ensemble Max", desc: "Scout → 3 models draft in parallel → strongest synthesizes → executor → reviewer. Best quality." },
  { id: "ensemble/fast", name: "Ensemble Fast", desc: "Executor with automatic failover + a second model reviewing the diff." },
];

export function modelLabel(id: string, models: ModelInfo[] = []): string {
  if (!id || id === "auto") return "Auto";
  const e = ENSEMBLES.find((x) => x.id === id);
  if (e) return e.name;
  const m = models.find((x) => x.id === id);
  if (m) return m.provider === "claude-code" ? `Claude Code${m.name !== "default" ? ` · ${m.name}` : ""}` : m.provider === "codex" ? "Codex" : m.name.split("/").pop()!;
  if (id.startsWith("opencode/")) return id.slice(9).replace(/-free$/, "");
  return id.split("/").slice(1).join("/").replace(/:free$/, "").split("/").pop() || id;
}

const TIERS: [ModelInfo["tier"], string][] = [["free", "Free"], ["local", "Local"], ["premium", "Premium"], ["agent", "Coding Agents"]];

export function ModelPicker({ value, onChange, compact, allowEnsembles = true, up = false }: { value: string; onChange: (v: string) => void; compact?: boolean; allowEnsembles?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const models = useStore((s) => s.models);
  const hidden = useStore((s) => new Set<string>(s.settings?.hiddenModels ?? []));

  const groups = useMemo(() => {
    const ql = q.toLowerCase();
    const vis = models.filter((m) => !hidden.has(m.id) && (allowEnsembles || m.kind !== "cli") && (!ql || m.id.toLowerCase().includes(ql) || m.name.toLowerCase().includes(ql)));
    const noSetup = vis.filter((m) => m.zeroSetup).sort((a, b) => Number(a.kind === "cli") - Number(b.kind === "cli") || b.score - a.score);
    return [
      ["Free · No setup", noSetup] as const,
      ...TIERS.map(([tier, label]) => [label, vis.filter((m) => m.tier === tier && !m.zeroSetup)] as const),
    ].filter(([, ms]) => ms.length);
  }, [models, q, hidden, allowEnsembles]);

  const pick = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  const isEnsemble = value.startsWith("ensemble/");

  return (
    <div className="picker-anchor">
      <button className={`chip-btn ${compact ? "compact" : ""} ${isEnsemble ? "ensemble" : ""}`} onClick={() => setOpen(!open)} title="Select model">
        {isEnsemble && <Icon name="organization" />}
        <span>{modelLabel(value, models)}</span>
        <Icon name="chevron-down" className="chev" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className={`model-menu ${up ? "up" : ""}`}>
        <div className="menu-search"><input autoFocus placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="menu-scroll">
          {!q && (
            <div className={`model-row ${value === "auto" ? "selected" : ""}`} onClick={() => pick("auto")}>
              <div className="model-main"><span className="model-name">Auto</span><span className="badge-free">FREE</span></div>
              <div className="model-desc">Best free model available — works with no setup, and fails over automatically on rate limits</div>
              {value === "auto" && <Icon name="check" className="model-check" />}
            </div>
          )}
          {allowEnsembles && !q && (
            <>
              <div className="menu-group">Spacebar Ensembles</div>
              {ENSEMBLES.map((e) => (
                <div key={e.id} className={`model-row ${value === e.id ? "selected" : ""}`} onClick={() => pick(e.id)}>
                  <div className="model-main"><Icon name="organization" /><span className="model-name">{e.name}</span><span className="badge-free">FREE</span></div>
                  <div className="model-desc">{e.desc}</div>
                  {value === e.id && <Icon name="check" className="model-check" />}
                </div>
              ))}
            </>
          )}
          {groups.map(([label, ms]) => (
            <div key={label}>
              <div className="menu-group">{label}</div>
              {ms.map((m) => (
                <div key={m.id} className={`model-row ${value === m.id ? "selected" : ""}`} onClick={() => pick(m.id)}>
                  <div className="model-main">
                    <span className="model-name">{modelLabel(m.id, models)}</span>
                    {m.zeroSetup && <span className="badge-free">FREE</span>}
                    {m.kind === "cli" && <span className="badge-agent">AGENT</span>}
                    <span className="model-provider">{m.provider === "opencode" ? "via OpenCode" : m.providerName.replace(/ \(.*\)/, "")}</span>
                  </div>
                  {value === m.id && <Icon name="check" className="model-check" />}
                </div>
              ))}
            </div>
          ))}
          {!models.length && <div className="menu-empty">No models yet. Add a free API key to get started.</div>}
        </div>
        <div className="menu-footer" onClick={() => { setOpen(false); openSettings("models"); }}><Icon name="add" /> Add models</div>
      </Popover>
    </div>
  );
}
