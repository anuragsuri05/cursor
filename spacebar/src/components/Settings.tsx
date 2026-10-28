import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { loadModels, saveSettings } from "../lib/actions";
import { MOD, setState, toast, useStore } from "../lib/store";
import { modelLabel } from "./ModelPicker";
import { Icon, Spinner, Toggle } from "./small";

const SECTIONS = [
  ["general", "General", "settings-gear"],
  ["models", "Models", "sparkle"],
  ["ensemble", "Ensembles", "organization"],
  ["tab", "Tab", "symbol-keyword"],
  ["agent", "Agent", "infinity"],
  ["rules", "Rules & Memories", "book"],
] as const;

export function SettingsModal() {
  const section = useStore((s) => s.settingsSection);
  const close = () => setState({ settingsOpen: false });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="settings-nav-title">Spacebar Settings</div>
          {SECTIONS.map(([id, label, icon]) => (
            <div key={id} className={`settings-nav-item ${section === id ? "active" : ""}`} onClick={() => setState({ settingsSection: id })}>
              <Icon name={icon} /> {label}
            </div>
          ))}
        </div>
        <div className="settings-body">
          <button className="icon-btn settings-close" onClick={close}><Icon name="close" /></button>
          {section === "general" && <General />}
          {section === "models" && <Models />}
          {section === "ensemble" && <Ensemble />}
          {section === "tab" && <TabSettings />}
          {section === "agent" && <AgentSettings />}
          {section === "rules" && <Rules />}
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text"><div className="set-title">{title}</div>{desc && <div className="set-desc">{desc}</div>}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function General() {
  const ws = useStore((s) => s.workspace);
  return (
    <>
      <h2>General</h2>
      <div className="set-card">
        <Row title="Workspace" desc={ws?.root ?? "No folder open"}><button className="btn" onClick={() => setState({ folderPickerOpen: true, settingsOpen: false })}>Open Folder…</button></Row>
        <Row title="Keyboard shortcuts" desc={`${MOD}I Agent · ${MOD}K Inline edit · ${MOD}L Add to chat · ${MOD}P Go to file · ⇧${MOD}P Commands · ${MOD}B Sidebar · ${MOD}J Panel · ⇧Tab Switch mode`}><span /></Row>
        <Row title="Data" desc="Settings and API keys are stored locally in ~/.spacebar (file mode 600). Keys are only sent to the provider you configured."><span /></Row>
      </div>
    </>
  );
}

function Models() {
  const models = useStore((s) => s.models);
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const hidden = new Set<string>(settings?.hiddenModels ?? []);
  const filtered = models.filter((m) => m.id.toLowerCase().includes(q.toLowerCase()));

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...hidden].filter((h) => h !== id) : [...hidden, id];
    saveSettings({ hiddenModels: next });
  };
  const refresh = async () => { setRefreshing(true); await loadModels(true); setRefreshing(false); };

  const tiers: [string, string, string][] = [
    ["nosetup", "Free · No setup needed", "These work immediately — no account, no key. Add an optional key only if you want higher limits."],
    ["free", "More free providers", "Generous free tiers — sign up, paste the key, done. More models and higher limits."],
    ["local", "Local models", "Run models on your own machine. Free and private."],
    ["premium", "Premium providers (optional)", "Bring your own key for Claude, GPT and others."],
    ["agent", "Coding agents (optional)", "Use Claude Code or Codex with your existing subscription — they run in your workspace."],
  ];

  return (
    <>
      <h2>Models</h2>
      <div className="set-card">
        <div className="models-toolbar">
          <input placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost" onClick={refresh}>{refreshing ? <Spinner /> : <Icon name="refresh" />} Refresh</button>
        </div>
        <div className="models-list">
          {filtered.slice(0, 300).map((m) => (
            <div key={m.id} className="model-toggle-row">
              <span className="model-toggle-name">{modelLabel(m.id, models)}</span>
              <span className={`tier-badge ${m.tier}`}>{m.tier}</span>
              <span className="model-provider">{m.providerName}</span>
              <span className="spacer" />
              <Toggle checked={!hidden.has(m.id)} onChange={(v) => toggle(m.id, v)} />
            </div>
          ))}
          {!models.length && <div className="menu-empty">No models available yet — add a key below.</div>}
        </div>
      </div>
      {tiers.map(([tier, title, desc]) => (
        <div key={tier}>
          <h3>{title}</h3>
          <p className="set-desc">{desc}</p>
          <div className="set-card">
            {providers.filter((p) => (tier === "nosetup" ? p.zeroSetup : p.tier === tier && !p.zeroSetup)).map((p) => <ProviderRow key={p.id} p={p} settings={settings} />)}
          </div>
        </div>
      ))}
    </>
  );
}

function ProviderRow({ p, settings }: { p: any; settings: any }) {
  const [key, setKey] = useState("");
  const [base, setBase] = useState(p.baseURL ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const enabled = settings?.providers?.[p.id]?.enabled !== false;
  const save = async (patch: any) => { await saveSettings({ providers: { [p.id]: { ...(settings?.providers?.[p.id] ?? {}), ...patch } } }); await loadModels(true); };
  const test = async () => {
    setTesting(true); setResult(null);
    try { setResult(await api.post("/api/providers/test", { id: p.id })); } catch (e: any) { setResult({ ok: false, message: e.message }); }
    setTesting(false);
  };
  const status = p.kind === "cli" ? (p.installed ? "Installed · ready" : "Not installed") : p.hasKey ? (p.fromEnv ? `Key from $${p.envKey}` : "Key saved") : p.noKey ? (p.keyOptional ? "Ready · no key needed" : "No key needed") : "Not configured";
  return (
    <div className="provider-row">
      <div className="provider-head">
        <span className={`status-dot ${p.configured ? "on" : ""}`} />
        <span className="provider-name">{p.name}</span>
        <span className="provider-status">{status}</span>
        <span className="spacer" />
        {p.id === "opencode" && !p.installed && (
          <button className="btn primary sm" onClick={() => { window.dispatchEvent(new CustomEvent("spacebar:run-in-terminal", { detail: "curl -fsSL https://opencode.ai/install | bash" })); setState({ settingsOpen: false }); }}>Install OpenCode</button>
        )}
        {p.signup && !(p.id === "opencode" && !p.installed) && <a className="link" href={p.signup} target="_blank" rel="noreferrer">{p.kind === "cli" ? (p.installed ? "Docs" : "Install") : p.keyOptional ? "Free token" : p.noKey ? "Download" : "Get free key"} <Icon name="link-external" /></a>}
        <Toggle checked={enabled} onChange={(v) => save({ enabled: v })} />
      </div>
      {p.note && <div className="set-desc">{p.note}</div>}
      {enabled && (
        <div className="provider-fields">
          {(!p.noKey || p.keyOptional) && (
            <input type="password" placeholder={p.hasKey ? "••••••••  (saved — paste to replace)" : p.keyOptional ? "Optional: paste a free token for higher limits" : `Paste ${p.name} API key`} value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && key) { save({ apiKey: key }); setKey(""); toast("Key saved"); } }} />
          )}
          {(p.id === "custom" || p.tier === "local") && <input placeholder="Base URL" value={base} onChange={(e) => setBase(e.target.value)} onBlur={() => base !== p.baseURL && save({ baseURL: base })} />}
          {(!p.noKey || p.keyOptional) && <button className="btn" disabled={!key} onClick={() => { save({ apiKey: key }); setKey(""); toast("Key saved"); }}>Save</button>}
          {p.hasKey && !p.fromEnv && <button className="btn ghost" onClick={() => save({ apiKey: "" })}>Remove</button>}
          <button className="btn ghost" onClick={test} disabled={testing}>{testing ? <Spinner /> : "Test"}</button>
        </div>
      )}
      {result && <div className={`test-result ${result.ok ? "ok" : "bad"}`}><Icon name={result.ok ? "pass" : "error"} /> {result.message}</div>}
    </div>
  );
}

function Ensemble() {
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models.filter((m) => m.kind !== "cli"));
  const e = settings?.ensemble ?? { pool: [], judge: "", proposers: 3, reviewRounds: 1 };
  const set = (patch: any) => saveSettings({ ensemble: { ...e, ...patch } });
  const auto = useMemo(() => [...models].sort((a, b) => (b.tier === "free" || b.tier === "local" ? 100 : 0) + b.score * 2 - ((a.tier === "free" || a.tier === "local" ? 100 : 0) + a.score * 2)).slice(0, 4), [models]);
  return (
    <>
      <h2>Ensembles</h2>
      <p className="set-desc lead">
        Ensembles combine several models so the result beats any single one. <b>Ensemble Max</b> runs:
        a fast <b>scout</b> gathers codebase context → <b>{e.proposers} proposers</b> draft independently in parallel →
        the strongest model <b>synthesizes</b> the best answer/plan → an <b>executor</b> implements it with automatic failover across providers →
        a different model <b>reviews the diff</b> and the executor fixes real issues. <b>Ensemble Fast</b> skips the drafting stage.
      </p>
      <div className="set-card">
        <Row title="Proposers" desc="How many models draft in parallel (more = better quality, more requests).">
          <select value={e.proposers} onChange={(ev) => set({ proposers: Number(ev.target.value) })}>{[2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
        </Row>
        <Row title="Review rounds" desc="How many review → fix cycles after implementing.">
          <select value={e.reviewRounds} onChange={(ev) => set({ reviewRounds: Number(ev.target.value) })}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
        </Row>
        <Row title="Judge / synthesizer" desc="Merges the drafts. Auto = the strongest model in the pool.">
          <select value={e.judge} onChange={(ev) => set({ judge: ev.target.value })}>
            <option value="">Auto</option>
            {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m.id, models)} ({m.providerName})</option>)}
          </select>
        </Row>
      </div>
      <h3>Model pool</h3>
      <p className="set-desc">Pick the models the ensemble may use (order = priority). Leave empty to auto-pick: {auto.map((m) => modelLabel(m.id, models)).join(", ") || "add providers first"}.</p>
      <div className="set-card models-list">
        {models.map((m) => {
          const i = e.pool.indexOf(m.id);
          return (
            <div key={m.id} className="model-toggle-row">
              <span className="pool-idx">{i >= 0 ? i + 1 : ""}</span>
              <span className="model-toggle-name">{modelLabel(m.id, models)}</span>
              <span className={`tier-badge ${m.tier}`}>{m.tier}</span>
              <span className="model-provider">{m.providerName}</span>
              <span className="spacer" />
              <Toggle checked={i >= 0} onChange={(v) => set({ pool: v ? [...e.pool, m.id] : e.pool.filter((x: string) => x !== m.id) })} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function TabSettings() {
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models.filter((m) => m.kind !== "cli"));
  return (
    <>
      <h2>Tab</h2>
      <div className="set-card">
        <Row title="Spacebar Tab" desc="AI autocomplete as you type: multi-line suggestions, accept with Tab, next word with ⌘→."><Toggle checked={!!settings?.tabEnabled} onChange={(v) => saveSettings({ tabEnabled: v })} /></Row>
        <Row title="Tab model" desc="Auto prefers Codestral (native fill-in-the-middle), then the fastest free model (Groq / Cerebras).">
          <select value={settings?.tabModel ?? "auto"} onChange={(e) => saveSettings({ tabModel: e.target.value })}>
            <option value="auto">Auto</option>
            {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m.id, models)} ({m.providerName})</option>)}
          </select>
        </Row>
      </div>
    </>
  );
}

function AgentSettings() {
  const settings = useStore((s) => s.settings);
  const a = settings?.agent ?? { runMode: "allowlist", allowlist: [], denylist: [], maxSteps: 40 };
  const set = (patch: any) => saveSettings({ agent: { ...a, ...patch } });
  const [allow, setAllow] = useState(a.allowlist.join("\n"));
  const [deny, setDeny] = useState(a.denylist.join("\n"));
  return (
    <>
      <h2>Agent</h2>
      <div className="set-card">
        <Row title="Auto-run mode" desc="When the agent wants to run a terminal command.">
          <div className="segmented">
            {[["ask", "Ask every time"], ["allowlist", "Use allowlist"], ["auto", "Run everything"]].map(([id, l]) => (
              <button key={id} className={a.runMode === id ? "active" : ""} onClick={() => set({ runMode: id })}>{l}</button>
            ))}
          </div>
        </Row>
        <Row title="Max steps per request" desc="Upper bound on tool calls in one agent turn.">
          <input type="number" min={5} max={200} value={a.maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })} className="num" />
        </Row>
      </div>
      <h3>Command allowlist</h3>
      <p className="set-desc">Commands starting with these prefixes run without asking (in allowlist mode). One per line.</p>
      <textarea className="set-textarea" rows={8} value={allow} onChange={(e) => setAllow(e.target.value)} onBlur={() => set({ allowlist: allow.split("\n").map((s) => s.trim()).filter(Boolean) })} />
      <h3>Command denylist</h3>
      <p className="set-desc">Commands containing these are always blocked.</p>
      <textarea className="set-textarea" rows={4} value={deny} onChange={(e) => setDeny(e.target.value)} onBlur={() => set({ denylist: deny.split("\n").map((s) => s.trim()).filter(Boolean) })} />
    </>
  );
}

function Rules() {
  const settings = useStore((s) => s.settings);
  const [rules, setRules] = useState(settings?.userRules ?? "");
  return (
    <>
      <h2>Rules & Memories</h2>
      <h3>User rules</h3>
      <p className="set-desc">Applied to every chat in every project.</p>
      <textarea className="set-textarea" rows={10} placeholder="e.g. Always use TypeScript strict mode. Prefer functional components. Reply concisely." value={rules} onChange={(e) => setRules(e.target.value)} onBlur={() => saveSettings({ userRules: rules })} />
      <h3>Project rules</h3>
      <div className="set-card">
        <p className="set-desc">Spacebar automatically loads these from the open folder (compatible with Cursor and Claude Code):</p>
        <ul className="rules-list">
          <li><code>AGENTS.md</code> (or <code>CLAUDE.md</code> when there is no AGENTS.md)</li>
          <li><code>.spacebar/rules/*.md</code> and <code>.cursor/rules/*.mdc</code> — frontmatter <code>alwaysApply</code>, <code>globs</code> and <code>description</code> are honored</li>
          <li><code>.cursorrules</code> (legacy)</li>
        </ul>
      </div>
    </>
  );
}
