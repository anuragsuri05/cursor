import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { getSettings, publicSettings, saveSettings } from "./settings.js";
import { PROVIDERS, cliInstalled, listModels, providerById, providerConfigured, providerKey } from "./llm/providers.js";
import { chat } from "./llm/chat.js";
import * as ws from "./workspace.js";
import { acceptChanges, changeSummary, deleteSession, getSession, originalOf, resolveApproval, revertChanges, send, stop } from "./agent/session.js";
import { applySnippet, commitMessage, inlineEdit, tabComplete } from "./complete.js";
import { createTerminal, type Term } from "./terminal.js";

const PORT = Number(process.env.PORT || 4317);
const app = express();
app.use(express.json({ limit: "50mb" }));

const sockets = new Set<WebSocket>();
const broadcast = (msg: any) => { const s = JSON.stringify(msg); for (const c of sockets) if (c.readyState === WebSocket.OPEN) c.send(s); };
const broadcastFs = (paths: string[]) => broadcast({ type: "fs.changed", paths });

const h = (fn: (req: express.Request, res: express.Response) => Promise<any>) => async (req: express.Request, res: express.Response) => {
  try { const r = await fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); }
  catch (e: any) { if (!res.headersSent) res.status(400).json({ error: e.message || String(e) }); }
};

// ---- Workspace ---------------------------------------------------------------
app.get("/api/workspace", h(async () => ({ root: ws.getRoot(), name: path.basename(ws.getRoot() || ""), recent: getSettings().recentWorkspaces })));
app.post("/api/workspace/open", h(async (req) => { const root = ws.openWorkspace(req.body.path); watch(); return { root, name: path.basename(root) }; }));
app.get("/api/browse", h(async (req) => ws.browse(req.query.path as string)));

// ---- Files ---------------------------------------------------------------------
app.get("/api/fs/list", h(async (req) => ws.listDir((req.query.path as string) || ".")));
app.get("/api/fs/files", h(async () => ws.walkFiles()));
app.get("/api/fs/read", h(async (req) => {
  const p = req.query.path as string;
  const abs = ws.resolveSafe(p);
  const st = await fsp.stat(abs);
  if (st.size > 5 * 1024 * 1024) return { path: p, content: "", tooLarge: true };
  const buf = await fsp.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) return { path: p, content: "", binary: true };
  return { path: p, content: buf.toString("utf8") };
}));
app.post("/api/fs/write", h(async (req) => { await ws.writeFile(req.body.path, req.body.content); return { ok: true }; }));
app.post("/api/fs/mkdir", h(async (req) => { await fsp.mkdir(ws.resolveSafe(req.body.path), { recursive: true }); broadcastFs([req.body.path]); return { ok: true }; }));
app.post("/api/fs/create", h(async (req) => {
  if (await ws.exists(req.body.path)) throw new Error("A file with that name already exists");
  await ws.writeFile(req.body.path, ""); broadcastFs([req.body.path]); return { ok: true };
}));
app.post("/api/fs/rename", h(async (req) => { await fsp.rename(ws.resolveSafe(req.body.from), ws.resolveSafe(req.body.to)); broadcastFs([req.body.from, req.body.to]); return { ok: true }; }));
app.post("/api/fs/delete", h(async (req) => { await fsp.rm(ws.resolveSafe(req.body.path), { recursive: true, force: true }); broadcastFs([req.body.path]); return { ok: true }; }));
app.get("/api/search", h(async (req) => ws.search(req.query.q as string, {
  regex: req.query.regex === "1", caseSensitive: req.query.case === "1", glob: (req.query.glob as string) || undefined,
})));

// ---- Git -----------------------------------------------------------------------
app.get("/api/git/status", h(async () => ws.gitStatus()));
app.get("/api/git/original", h(async (req) => {
  try { return { content: await ws.git(["show", `HEAD:${req.query.path}`]) }; } catch { return { content: "" }; }
}));
app.post("/api/git/commit", h(async (req) => {
  await ws.git(["add", "-A"]);
  await ws.git(["commit", "-m", req.body.message]);
  return ws.gitStatus();
}));
app.post("/api/git/commit-message", h(async () => {
  let diff = await ws.git(["diff", "HEAD"]).catch(() => "");
  if (!diff.trim()) diff = await ws.git(["diff", "--cached"]).catch(() => "");
  const status = await ws.gitStatus();
  const untracked = status.files.filter((f) => f.status === "??").map((f) => `new file: ${f.path}`).join("\n");
  return { message: await commitMessage(`${diff}\n${untracked}`) };
}));
app.post("/api/git/init", h(async () => { await ws.git(["init"]); return ws.gitStatus(); }));

// ---- Settings & models ---------------------------------------------------------
app.get("/api/settings", h(async () => publicSettings()));
app.post("/api/settings", h(async (req) => {
  const patch = req.body;
  // Never overwrite a stored key with its masked placeholder.
  for (const [id, p] of Object.entries<any>(patch.providers ?? {})) {
    if (typeof p.apiKey === "string" && p.apiKey.startsWith("••••")) delete p.apiKey;
    if (p.apiKey === "") patch.providers[id].apiKey = undefined;
  }
  saveSettings(patch);
  return publicSettings();
}));
app.get("/api/providers", h(async () => PROVIDERS.map((p) => ({
  id: p.id, name: p.name, kind: p.kind, tier: p.tier, signup: p.signup, note: p.note, noKey: !!p.noKey,
  zeroSetup: !!p.zeroSetup, keyOptional: !!p.keyOptional,
  baseURL: getSettings().providers[p.id]?.baseURL ?? p.baseURL, envKey: p.envKey,
  hasKey: !!providerKey(p), fromEnv: !getSettings().providers[p.id]?.apiKey && !!(p.envKey && process.env[p.envKey]),
  configured: providerConfigured(p), enabled: getSettings().providers[p.id]?.enabled !== false,
  installed: p.kind === "cli" ? cliInstalled(p.command!) : undefined,
}))));
app.get("/api/models", h(async (req) => listModels(req.query.refresh === "1")));
app.post("/api/providers/test", h(async (req) => {
  const p = providerById(req.body.id);
  if (!p) throw new Error("Unknown provider");
  const models = (await listModels(true)).filter((m) => m.provider === p.id);
  if (p.kind === "cli") return { ok: cliInstalled(p.command!), message: cliInstalled(p.command!) ? `${p.command} is installed` : `${p.command} not found on PATH` };
  if (!models.length) return { ok: false, message: "No models returned. Check the key / that the server is running." };
  const t0 = Date.now();
  try {
    const r = await chat({ model: models[0].id, messages: [{ role: "user", content: "Reply with: ok" }], maxTokens: 16, signal: AbortSignal.timeout(30000) });
    return { ok: true, message: `${models.length} models · ${models[0].name} replied in ${Date.now() - t0} ms: "${r.text.trim().slice(0, 40)}"` };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}));

// ---- AI features ---------------------------------------------------------------
const tabAborts = new Map<string, AbortController>();
app.post("/api/complete", h(async (req) => {
  if (!getSettings().tabEnabled) return { text: "" };
  const key = req.body.path;
  tabAborts.get(key)?.abort();
  const ac = new AbortController();
  tabAborts.set(key, ac);
  req.on("close", () => { if (!req.complete) ac.abort(); });
  return { text: await tabComplete(req.body, ac.signal) };
}));

app.post("/api/inline-edit", async (req, res) => {
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  try {
    await inlineEdit(req.body, (d) => res.write(d), ac.signal);
  } catch (e: any) {
    if (!ac.signal.aborted) res.write(`\u0000ERROR:${e.message}`);
  }
  res.end();
});

app.post("/api/apply", h(async (req) => ({ content: await applySnippet(req.body) })));
app.get("/api/chat/changes", h(async (req) => changeSummary(getSession(req.query.sessionId as string))));
app.get("/api/chat/original", h(async (req) => ({ content: originalOf(req.query.sessionId as string, req.query.path as string) ?? null })));
app.post("/api/chat/revert", h(async (req) => { const paths = await revertChanges(req.body.sessionId, req.body.path); broadcastFs(paths); return { paths }; }));
app.post("/api/chat/accept", h(async (req) => { acceptChanges(req.body.sessionId, req.body.path); return { ok: true }; }));
app.post("/api/chat/delete", h(async (req) => { deleteSession(req.body.sessionId); return { ok: true }; }));

// ---- Static (production) ---------------------------------------------------------
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// ---- WebSocket: chat streaming, approvals, terminals ------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (sock, req) => {
  const origin = req.headers.origin ?? "";
  if (origin && !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/)/.test(origin)) { sock.close(); return; }
  sockets.add(sock);
  const terms = new Map<string, Term>();
  const sendTo = (m: any) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(m));

  sock.on("message", (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    switch (m.type) {
      case "chat.send": send(m, broadcast, broadcastFs); break;
      case "chat.stop": stop(m.sessionId); break;
      case "approval.reply": resolveApproval(m.id, !!m.approved); break;
      case "term.create": {
        const t = createTerminal(m.cols || 80, m.rows || 24, (d) => sendTo({ type: "term.data", id: m.id, data: d }), (code) => { sendTo({ type: "term.exit", id: m.id, code }); terms.delete(m.id); });
        terms.set(m.id, t);
        break;
      }
      case "term.input": terms.get(m.id)?.write(m.data); break;
      case "term.resize": terms.get(m.id)?.resize(m.cols, m.rows); break;
      case "term.kill": terms.get(m.id)?.kill(); terms.delete(m.id); break;
    }
  });
  sock.on("close", () => { sockets.delete(sock); for (const t of terms.values()) t.kill(); });
});

// ---- File watcher → explorer/editor refresh ------------------------------------------
let watcher: fs.FSWatcher | null = null;
let pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;
function watch() {
  watcher?.close();
  const root = ws.getRoot();
  if (!root) return;
  try {
    watcher = fs.watch(root, { recursive: true }, (_e, file) => {
      if (!file || /(^|\/)(\.git|node_modules)(\/|$)/.test(file)) return;
      pending.add(file.toString());
      timer ??= setTimeout(() => { broadcastFs([...pending]); pending = new Set(); timer = null; }, 150);
    });
  } catch { /* recursive watch unsupported */ }
}

// ---- Boot ------------------------------------------------------------------------------
const initial = process.argv[2] || process.env.SPACEBAR_WORKSPACE || getSettings().lastWorkspace;
if (initial) { try { ws.openWorkspace(initial); watch(); } catch { /* ignore */ } }

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Spacebar server  →  http://127.0.0.1:${PORT}`);
  console.log(`  Workspace     →  ${ws.getRoot() || "(none — open a folder in the app)"}\n`);
});
