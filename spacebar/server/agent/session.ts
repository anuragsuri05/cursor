import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chat, chatWithFailover, type ChatResult, type Msg, type ToolDef } from "../llm/chat.js";
import { cliPath, coolingDown, listModels, pickModels, providerById, splitModel } from "../llm/providers.js";
import { SPACEBAR_HOME, getSettings } from "../settings.js";
import { getRoot, readFile, resolveSafe, walkFiles, writeFile } from "../workspace.js";
import { contextBlock, systemPrompt, type ChatContext, type Mode } from "./prompts.js";
import { READ_TOOLS, WRITE_TOOLS, runTool, type ToolContext } from "./tools.js";

export type Emit = (event: any) => void;

export interface FileChange { path: string; original: string | null }

export interface Session {
  id: string;
  messages: Msg[];
  changes: Map<string, FileChange>;
  abort?: AbortController;
  /** Resume ids for external agents, keyed by agent. */
  cliSessions?: Record<string, string>;
}

const sessions = new Map<string, Session>();
const SESS_DIR = path.join(SPACEBAR_HOME, "sessions");

export function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { id, messages: [], changes: new Map() };
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(SESS_DIR, `${id}.json`), "utf8"));
      s.messages = saved.messages ?? [];
      s.cliSessions = saved.cliSessions;
    } catch { /* new session */ }
    sessions.set(id, s);
  }
  return s;
}

function persist(s: Session) {
  fs.mkdirSync(SESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SESS_DIR, `${s.id}.json`), JSON.stringify({ messages: s.messages, cliSessions: s.cliSessions }));
}

export function deleteSession(id: string) {
  sessions.delete(id);
  try { fs.unlinkSync(path.join(SESS_DIR, `${id}.json`)); } catch { /* none */ }
}

// ---------------------------------------------------------------------------
// Pending approvals (shell commands awaiting the user's Run / Skip)

const approvals = new Map<string, (ok: boolean) => void>();
export function resolveApproval(id: string, ok: boolean) { approvals.get(id)?.(ok); approvals.delete(id); }

// ---------------------------------------------------------------------------

export interface SendRequest {
  sessionId: string;
  mode: Mode;
  model: string; // "auto" | "ensemble/max" | "ensemble/fast" | "provider/model"
  text: string;
  context?: ChatContext;
}

export async function send(req: SendRequest, emit: Emit, broadcastFs: (paths: string[]) => void) {
  const s = getSession(req.sessionId);
  s.abort?.abort();
  const abort = new AbortController();
  s.abort = abort;

  const ev = (e: any) => emit({ type: "chat.event", sessionId: s.id, event: e });
  const toolCtx: ToolContext = {
    signal: abort.signal,
    checkpoint: (p, original) => {
      if (!s.changes.has(p)) s.changes.set(p, { path: p, original });
    },
    onFileChanged: (p) => broadcastFs([p]),
    approve: ({ command }) =>
      new Promise((resolve) => {
        const id = `ap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        approvals.set(id, resolve);
        emit({ type: "approval.request", sessionId: s.id, id, command });
        abort.signal.addEventListener("abort", () => resolveApproval(id, false), { once: true });
      }),
  };

  try {
    const { provider } = splitModel(req.model);
    if (providerById(provider)?.kind === "cli") {
      await runCliAgent(s, req, ev, toolCtx);
    } else {
      const userMsg: Msg = { role: "user", content: contextBlock(req.context) + req.text, images: req.context?.images };
      s.messages.push(userMsg);
      if (req.model.startsWith("ensemble/")) await runEnsemble(s, req, ev, toolCtx);
      else await runSingle(s, req, ev, toolCtx);
    }
    ev({ kind: "changes", files: await changeSummary(s) });
    ev({ kind: "done" });
  } catch (e: any) {
    if (abort.signal.aborted) ev({ kind: "done", stopped: true });
    else ev({ kind: "error", message: e.message || String(e) });
  } finally {
    if (s.abort === abort) s.abort = undefined;
    persist(s);
  }
}

export function stop(sessionId: string) { getSession(sessionId).abort?.abort(); }

async function modelChain(model: string, fast = false): Promise<string[]> {
  if (model === "auto" || !model) return pickModels(4, { preferFree: true, fast });
  // A specific model, with free fallbacks behind it if it's rate limited.
  const backups = await pickModels(2, { preferFree: true, exclude: [model] }).catch(() => []);
  return [model, ...backups];
}

// ---------------------------------------------------------------------------
// The core tool loop, shared by single-model chat and ensemble executors.

interface LoopOpts {
  models: string[];
  messages: Msg[];
  tools: ToolDef[];
  ev: Emit;
  ctx: ToolContext;
  maxSteps?: number;
  /** When set, text/reasoning are emitted as part of a stage instead of the main answer. */
  stageId?: string;
  quiet?: boolean;
}

async function toolLoop(o: LoopOpts): Promise<{ text: string; transcript: string; model: string }> {
  const maxSteps = o.maxSteps ?? getSettings().agent.maxSteps;
  let models = o.models;
  let finalText = "";
  let transcript = "";
  let used = models[0];
  for (let step = 0; step < maxSteps; step++) {
    if (o.ctx.signal.aborted) throw new Error("aborted");
    let r: ChatResult;
    r = await chatWithFailover(
      models,
      {
        messages: o.messages,
        tools: o.tools,
        signal: o.ctx.signal,
        onText: (d) => !o.quiet && o.ev({ kind: "text", delta: d, stageId: o.stageId }),
        onReasoning: (d) => !o.quiet && o.ev({ kind: "reasoning", delta: d, stageId: o.stageId }),
      },
      (from, to, why) => o.ev({ kind: "notice", text: `${short(from)} unavailable (${why.slice(0, 120)}), switching to ${short(to)}` }),
    );
    // Stick with whichever model answered for the rest of this loop.
    if (r.model !== models[0]) models = [r.model, ...models.filter((m) => m !== r.model)];
    used = r.model;
    o.messages.push({ role: "assistant", content: r.text, tool_calls: r.toolCalls.length ? r.toolCalls : undefined, raw: r.raw });
    finalText = r.text;
    if (!r.toolCalls.length) break;

    // Read-only tools run in parallel; mutating tools run in order.
    const results = new Map<string, string>();
    const readOnly = new Set(READ_TOOLS.map((t) => t.name));
    const exec = async (tc: (typeof r.toolCalls)[number]) => {
      let args: any = {};
      try { args = JSON.parse(tc.arguments || "{}"); } catch { /* shown raw */ }
      o.ev({ kind: "tool", id: tc.id, name: tc.name, args, status: "running", stageId: o.stageId });
      const res = await runTool(tc.name, tc.arguments, o.ctx);
      const status = res.meta?.error ? "error" : res.meta?.skipped ? "skipped" : "done";
      o.ev({ kind: "tool", id: tc.id, name: tc.name, args, status, output: res.output.slice(0, 8000), meta: res.meta, stageId: o.stageId });
      results.set(tc.id, res.output);
      transcript += `\n### ${tc.name}(${tc.arguments.slice(0, 200)})\n${res.output.slice(0, 6000)}\n`;
    };
    await Promise.all(r.toolCalls.filter((t) => readOnly.has(t.name)).map(exec));
    for (const tc of r.toolCalls.filter((t) => !readOnly.has(t.name))) await exec(tc);
    for (const tc of r.toolCalls) o.messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: results.get(tc.id) ?? "" });
    if (step === maxSteps - 1) o.ev({ kind: "notice", text: `Stopped after ${maxSteps} steps. Send "continue" to keep going.` });
  }
  return { text: finalText, transcript, model: used };
}

const short = (m: string) => splitModel(m).model.replace(/:free$/, "").split("/").pop()!;

/** Best free OpenCode model, used when every keyless API is rate limited. */
async function openCodeFallback(): Promise<string | null> {
  const [m] = (await pickModels(1, { preferFree: true, includeAgents: true })).filter((id) => id.startsWith("opencode/"));
  if (m) return m;
  const all = (await listModels()).filter((x) => x.provider === "opencode" && !coolingDown(x.id));
  return all.sort((a, b) => b.score - a.score)[0]?.id ?? null;
}

async function viaOpenCode(s: Session, req: SendRequest, ev: Emit, ctx: ToolContext, why: string): Promise<boolean> {
  const oc = await openCodeFallback();
  if (!oc) return false;
  ev({ kind: "notice", text: `${why} Continuing with ${oc.slice(9)} (free, via OpenCode).` });
  // The user message was already recorded; runCliAgent records its own turn.
  s.messages.pop();
  await runCliAgent(s, { ...req, model: oc }, ev, ctx);
  return true;
}

async function runSingle(s: Session, req: SendRequest, ev: Emit, ctx: ToolContext) {
  const models = await modelChain(req.model);
  if (!models.length) {
    if (await viaOpenCode(s, req, ev, ctx, "No API models are available right now (free quotas may be used up).")) return;
    throw new Error("No models are available. Check your internet connection, add a free API key in Settings → Models, or install OpenCode for free models.");
  }
  ev({ kind: "model", model: models[0] });
  const sys: Msg = { role: "system", content: await systemPrompt(req.mode, activeFiles(req)) };
  const working = [sys, ...s.messages];
  const before = working.length;
  try {
    await toolLoop({ models, messages: working, tools: req.mode === "agent" ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS, ev, ctx });
  } catch (e: any) {
    // Free tiers ran out mid-task: hand over to an OpenCode free model if nothing was done yet.
    if (!ctx.signal.aborted && working.length === before && /429|quota|rate limit/i.test(String(e.message))
      && await viaOpenCode(s, req, ev, ctx, "Free API quotas are exhausted.")) return;
    throw e;
  }
  s.messages.push(...working.slice(before));
}

const activeFiles = (req: SendRequest) => [req.context?.currentFile, ...(req.context?.files ?? []).map((f) => f.path)].filter(Boolean) as string[];

// ---------------------------------------------------------------------------
// Ensembles: combine several (free) models to beat any single one.
//
//  1. Scout     – a fast model explores the codebase with read-only tools and collects context.
//  2. Proposers – N diverse models independently answer / plan in parallel (Mixture-of-Agents).
//  3. Synth     – the strongest model critiques the proposals and writes the single best answer/plan.
//  4. Executor  – (agent mode) a tool-using model implements the plan, with automatic failover.
//  5. Reviewer  – a different model reviews the diff; the executor fixes issues (N rounds).

async function runEnsemble(s: Session, req: SendRequest, ev: Emit, ctx: ToolContext) {
  const st = getSettings().ensemble;
  const isMax = req.model === "ensemble/max";
  const pool = (st.pool.length ? st.pool : await pickModels(Math.max(st.proposers, 3) + 1, { preferFree: true, includeAgents: true }))
    .filter((m) => !coolingDown(m));
  if (!pool.length) throw new Error("No models available for the ensemble. Add free API keys in Settings → Models or install OpenCode.");
  // Prefer an API model as judge (faster); OpenCode models still draft and review.
  const judge = st.judge || pool.find((m) => !m.startsWith("opencode/")) || pool[0];
  const fastChain = await pickModels(3, { preferFree: true, fast: true });
  const sys = await systemPrompt(req.mode, activeFiles(req));
  const userText = s.messages[s.messages.length - 1].content;
  const history = s.messages.slice(0, -1).filter((m) => m.role === "user" || (m.role === "assistant" && m.content)).slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 3000)}`).join("\n\n");

  const stage = (id: string, label: string, status: string, extra: any = {}) => ev({ kind: "stage", id, label, status, ...extra });

  // 1. Scout
  let dossier = "";
  if (!(isMax === false && req.mode === "agent")) {
    stage("scout", "Gathering context", "running", { model: fastChain[0] });
    const scoutMsgs: Msg[] = [
      { role: "system", content: `${sys}\n\nYou are the SCOUT for a team of models. Use the read-only tools to find the files and code relevant to the request (usually 2-8 tool calls). Then reply with a brief note listing the relevant files and key facts. Do not solve the task.` },
      { role: "user", content: (history ? `Earlier conversation:\n${history}\n\n` : "") + userText },
    ];
    try {
      if (!fastChain.length) throw new Error("no tool-capable API model available; drafters will explore the repo themselves");
      const r = await toolLoop({ models: fastChain, messages: scoutMsgs, tools: READ_TOOLS, ev, ctx, maxSteps: 10, stageId: "scout", quiet: true });
      dossier = `${r.text}\n\n<tool_outputs>${r.transcript.slice(0, 60_000)}</tool_outputs>`;
      stage("scout", "Gathered context", "done", { model: r.model });
    } catch (e: any) {
      if (ctx.signal.aborted) throw e;
      stage("scout", "Context gathering failed, continuing", "error", { detail: e.message });
    }
  }

  const taskBlock = `${history ? `<conversation>\n${history}\n</conversation>\n\n` : ""}<request>\n${userText}\n</request>\n\n${dossier ? `<codebase_context>\n${dossier}\n</codebase_context>` : ""}`;

  let plan = "";
  if (isMax || req.mode !== "agent") {
    // 2. Proposers (parallel)
    // Re-check quotas: the scout may have just exhausted one.
    const live = pool.filter((m) => !coolingDown(m));
    const proposers = (live.length ? live : pool).slice(0, st.proposers);
    const what = req.mode === "ask" ? "answer" : "implementation plan";
    stage("propose", `${proposers.length} models drafting ${what}s`, "running", { models: proposers });
    const proposals = await Promise.all(
      proposers.map(async (m, i) => {
        const pid = `p${i}`;
        ev({ kind: "proposal", id: pid, model: m, status: "running" });
        try {
          const r = await chatWithFailover([m, ...pool.filter((x) => !proposers.includes(x))], {
            messages: [
              { role: "system", content: sys },
              { role: "user", content: `${taskBlock}\n\nWrite your best ${what}. ${req.mode === "ask" ? "Be correct and specific; cite code." : "List exact files, functions and edits. Point out risks and edge cases."}` },
            ],
            signal: ctx.signal,
            onText: (d) => ev({ kind: "proposal", id: pid, model: m, delta: d }),
          });
          ev({ kind: "proposal", id: pid, model: r.model, status: "done" });
          return { model: r.model, text: r.text };
        } catch (e: any) {
          ev({ kind: "proposal", id: pid, model: m, status: "error", detail: e.message });
          return null;
        }
      }),
    );
    const ok = proposals.filter(Boolean) as { model: string; text: string }[];
    stage("propose", `${ok.length} drafts ready`, ok.length ? "done" : "error");
    if (!ok.length) throw new Error("All proposer models failed. Check your API keys / rate limits.");

    // 3. Synthesizer
    const synthModel = !coolingDown(judge) ? judge : (pool.find((m) => !coolingDown(m) && !m.startsWith("opencode/")) ?? pool.find((m) => !coolingDown(m)) ?? judge);
    stage("synth", req.mode === "ask" ? "Synthesizing best answer" : "Synthesizing plan", "running", { model: synthModel });
    const synthPrompt = `${taskBlock}

You are given ${ok.length} candidate ${what}s written independently by different models:

${ok.map((p, i) => `<candidate id="${i + 1}" model="${short(p.model)}">\n${p.text}\n</candidate>`).join("\n\n")}

Critically evaluate them: check each claim against the codebase context, note mistakes, and combine the strongest parts.
Then write the single best ${what} as your final response. Do not mention the candidates or this process; just give the ${what}.${req.mode === "ask" ? "" : " Use the plan format: summary, ## Changes (file by file), ## Steps (checklist), ## Verification."}`;
    const synthStream = req.mode !== "agent";
    const r = await chatWithFailover([synthModel, ...pool.filter((m) => m !== synthModel)], {
      messages: [{ role: "system", content: sys }, { role: "user", content: synthPrompt }],
      signal: ctx.signal,
      onText: (d) => ev({ kind: "text", delta: d, stageId: synthStream ? undefined : "synth" }),
      onReasoning: (d) => ev({ kind: "reasoning", delta: d, stageId: synthStream ? undefined : "synth" }),
    }, (from, to) => ev({ kind: "notice", text: `${short(from)} unavailable, switching to ${short(to)}` }));
    stage("synth", req.mode === "ask" ? "Answer synthesized" : "Plan ready", "done", { model: r.model });
    plan = r.text;
    if (req.mode !== "agent") {
      s.messages.push({ role: "assistant", content: r.text });
      return;
    }
  }

  // 4. Executor
  const execChain = [...new Set([...pool.filter((m) => !m.startsWith("opencode/")), ...(await pickModels(3, { preferFree: true }))])];
  const execPrompt = `${userText}${plan ? `\n\n<plan>\n${plan}\n</plan>\nImplement this plan now.` : ""}`;
  if (!execChain.length) {
    const oc = pool.find((m) => m.startsWith("opencode/")) ?? (await openCodeFallback());
    if (!oc) throw new Error("No model available to implement the plan.");
    stage("execute", "Implementing (OpenCode agent)", "running", { model: oc });
    await runCliAgent(s, { ...req, model: oc, text: execPrompt, context: undefined }, (e) => ev({ ...e, stageId: e.kind === "text" || e.kind === "tool" || e.kind === "reasoning" ? undefined : e.stageId }), ctx);
    stage("execute", "Implemented", "done", { model: oc });
    await reviewOnly(s, userText, pool, judge, oc, st.reviewRounds, ev, ctx, stage);
    return;
  }
  stage("execute", "Implementing", "running", { model: execChain[0] });
  const execMsgs: Msg[] = [
    { role: "system", content: sys },
    ...s.messages.slice(0, -1),
    {
      role: "user",
      content: `${userText}${plan ? `\n\n<plan>\n${plan}\n</plan>\nImplement this plan now.` : ""}${dossier ? `\n\n<codebase_context>\n${dossier.slice(0, 30_000)}\n</codebase_context>` : ""}`,
    },
  ];
  const before = execMsgs.length;
  let result = await toolLoop({ models: execChain, messages: execMsgs, tools: [...READ_TOOLS, ...WRITE_TOOLS], ev, ctx });
  stage("execute", "Implemented", "done", { model: result.model });

  // 5. Reviewer loop
  const reviewer = pool.find((m) => m !== result.model) ?? judge;
  for (let round = 0; round < st.reviewRounds; round++) {
    const diff = await changesDiff(s);
    if (!diff.trim()) break;
    stage(`review${round}`, "Reviewing changes", "running", { model: reviewer });
    const rv = await chatWithFailover([reviewer, judge], {
      messages: [
        { role: "system", content: "You are a meticulous senior code reviewer. Find real bugs only: logic errors, broken imports, type errors, unhandled cases, things that don't satisfy the request. Ignore style nits." },
        { role: "user", content: `<request>\n${userText}\n</request>\n\n<diff>\n${diff.slice(0, 80_000)}\n</diff>\n\nIf the change is correct and complete, reply with exactly "LGTM". Otherwise list each concrete problem with file and line, and how to fix it.` },
      ],
      signal: ctx.signal,
      onText: (d) => ev({ kind: "text", delta: d, stageId: `review${round}` }),
    });
    const lgtm = /^\s*LGTM\b/i.test(rv.text) || rv.text.trim().length < 8;
    stage(`review${round}`, lgtm ? "Review passed" : "Review found issues", "done", { model: rv.model, verdict: lgtm ? "pass" : "issues" });
    if (lgtm) break;
    stage(`fix${round}`, "Fixing review issues", "running", { model: result.model });
    execMsgs.push({ role: "user", content: `A reviewer found these problems. Fix the real ones (verify each against the code first), then summarize:\n\n${rv.text}` });
    result = await toolLoop({ models: [result.model, ...execChain.filter((m) => m !== result.model)], messages: execMsgs, tools: [...READ_TOOLS, ...WRITE_TOOLS], ev, ctx });
    stage(`fix${round}`, "Fixed", "done", { model: result.model });
  }
  s.messages.push(...execMsgs.slice(before).filter((m) => !(m.role === "user" && m.content.startsWith("A reviewer found"))));
}

// ---------------------------------------------------------------------------
// Change tracking (Keep / Undo, like Cursor's review bar)

export async function changeSummary(s: Session) {
  const out: { path: string; added: number; removed: number; status: "added" | "modified" | "deleted" }[] = [];
  for (const c of s.changes.values()) {
    let now: string | null = null;
    try { now = await readFile(c.path); } catch { /* deleted */ }
    if (now === c.original) continue;
    const a = (c.original ?? "").split("\n"), b = (now ?? "").split("\n");
    const setA = new Set(a), setB = new Set(b);
    out.push({
      path: c.path,
      added: now === null ? 0 : b.filter((l) => !setA.has(l)).length,
      removed: c.original === null ? 0 : a.filter((l) => !setB.has(l)).length,
      status: c.original === null ? "added" : now === null ? "deleted" : "modified",
    });
  }
  return out;
}

export async function changesDiff(s: Session): Promise<string> {
  const parts: string[] = [];
  for (const c of s.changes.values()) {
    let now = "";
    try { now = await readFile(c.path); } catch { now = ""; }
    if (now === c.original) continue;
    parts.push(unifiedDiff(c.path, c.original ?? "", now));
  }
  return parts.join("\n");
}

function unifiedDiff(file: string, a: string, b: string): string {
  // Minimal LCS-based line diff with 3 lines of context.
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 4_000_000) return `--- ${file}\n+++ ${file}\n(large change: ${A.length} → ${B.length} lines)\n${b.slice(0, 20000)}`;
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: { t: " " | "-" | "+"; l: string; ln: number }[] = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { ops.push({ t: " ", l: A[i], ln: j + 1 }); i++; j++; }
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: "+", l: B[j], ln: j + 1 }); j++; }
    else { ops.push({ t: "-", l: A[i], ln: j + 1 }); i++; }
  }
  const keep = ops.map((o, k) => o.t !== " " || ops.slice(Math.max(0, k - 3), k + 4).some((x) => x.t !== " "));
  let out = `--- a/${file}\n+++ b/${file}\n`;
  let gap = false;
  ops.forEach((o, k) => {
    if (keep[k]) { if (gap) out += `@@ line ${o.ln} @@\n`; gap = false; out += `${o.t}${o.l}\n`; } else gap = true;
  });
  return out;
}

export async function revertChanges(sessionId: string, file?: string) {
  const s = getSession(sessionId);
  const targets = file ? [s.changes.get(file)].filter(Boolean) as FileChange[] : [...s.changes.values()];
  for (const c of targets) {
    if (c.original === null) { try { fs.unlinkSync(resolveSafe(c.path)); } catch { /* gone */ } }
    else await writeFile(c.path, c.original);
    s.changes.delete(c.path);
  }
  return targets.map((t) => t.path);
}

export function acceptChanges(sessionId: string, file?: string) {
  const s = getSession(sessionId);
  if (file) s.changes.delete(file); else s.changes.clear();
}

export function originalOf(sessionId: string, file: string): string | null | undefined {
  return getSession(sessionId).changes.get(file)?.original;
}

// ---------------------------------------------------------------------------
// External coding agents: OpenCode (free models), Claude Code and Codex CLIs

/** Snapshot of text files before an external agent runs, so its edits can be kept or undone. */
async function snapshotWorkspace(): Promise<Map<string, string>> {
  const snap = new Map<string, string>();
  let total = 0;
  for (const f of await walkFiles(8000)) {
    try {
      const abs = resolveSafe(f);
      const st = fs.statSync(abs);
      if (st.size > 1_000_000 || total > 60_000_000) { snap.set(f, "\u0000skip"); continue; }
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 4000).includes(0)) { snap.set(f, "\u0000skip"); continue; }
      snap.set(f, buf.toString("utf8"));
      total += st.size;
    } catch { /* unreadable */ }
  }
  return snap;
}

async function recordExternalChanges(before: Map<string, string>, ctx: ToolContext) {
  const after = new Set(await walkFiles(8000));
  for (const f of after) {
    const old = before.get(f);
    if (old === "\u0000skip") continue;
    if (old === undefined) { ctx.checkpoint(f, null); continue; }
    try { if (fs.readFileSync(resolveSafe(f), "utf8") !== old) ctx.checkpoint(f, old); } catch { /* gone */ }
  }
  for (const [f, old] of before) if (!after.has(f) && old !== "\u0000skip") ctx.checkpoint(f, old);
}

const OPENCODE_TOOLS: Record<string, string> = {
  read: "read_file", edit: "edit_file", multiedit: "edit_file", patch: "edit_file", apply_patch: "edit_file", write: "write_file",
  bash: "run_command", grep: "grep", glob: "find_files", list: "list_dir",
};

async function runCliAgent(s: Session, req: SendRequest, ev: Emit, ctx: ToolContext) {
  const { provider, model } = splitModel(req.model);
  const runMode = getSettings().agent.runMode;
  const sessions = (s.cliSessions ??= {});
  let cmd: string, args: string[];
  if (provider === "opencode") {
    // OpenCode's free tier only works from OpenCode's own agents, so use its stock build/plan agents unchanged.
    cmd = cliPath("opencode") ?? "opencode";
    const prompt = contextBlock(req.context) + (req.mode === "ask" ? "Answer this question without modifying any files:\n" : "") + req.text;
    args = ["run", "--format", "json", "--dir", getRoot(), "-m", `opencode/${model}`, "--agent", req.mode === "agent" ? "build" : "plan"];
    if (sessions.opencode) args.push("--session", sessions.opencode);
    args.push(prompt);
    if (!sessions.opencode && req.mode === "agent") ev({ kind: "notice", text: "Running the OpenCode agent with OpenCode's default permissions (it may run commands without asking). Free models may use prompts for training." });
  } else if (provider === "claude-code") {
    cmd = cliPath("claude") ?? "claude";
    const prompt = contextBlock(req.context) + (req.mode === "ask" ? "Answer without modifying files: " : "") + req.text;
    args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    args.push("--permission-mode", req.mode === "agent" ? (runMode === "auto" ? "bypassPermissions" : "acceptEdits") : "plan");
    if (model && model !== "default") args.push("--model", model);
    if (sessions.claude) args.push("--resume", sessions.claude);
  } else {
    cmd = cliPath("codex") ?? "codex";
    const prompt = contextBlock(req.context) + (req.mode === "plan" ? "Do not modify files. Produce an implementation plan for: " : req.mode === "ask" ? "Answer without modifying files: " : "") + req.text;
    args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", req.mode === "agent" ? "workspace-write" : "read-only", prompt];
  }
  ev({ kind: "model", model: req.model });
  s.messages.push({ role: "user", content: req.text });
  const before = req.mode === "agent" ? await snapshotWorkspace() : null;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: getRoot(), env: { ...process.env, PWD: getRoot() }, stdio: ["ignore", "pipe", "pipe"] });
      ctx.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      let buf = "", errBuf = "", finalText = "", failure = "";
      const handle = (j: any) => {
        if (provider === "opencode") {
          if (j.sessionID) sessions.opencode = j.sessionID;
          const p = j.part ?? {};
          if (j.type === "text" && p.text) { ev({ kind: "text", delta: p.text + "\n" }); finalText += p.text + "\n"; }
          else if (j.type === "reasoning" && p.text) ev({ kind: "reasoning", delta: p.text });
          else if (j.type === "tool_use") {
            const st = p.state ?? {};
            const name = OPENCODE_TOOLS[p.tool] ?? p.tool;
            const input = st.input ?? {};
            const md = st.metadata ?? {};
            const fd = md.filediff;
            const meta = fd ? { added: Number(fd.additions ?? 0), removed: Number(fd.deletions ?? 0) }
              : name === "run_command" ? { exitCode: md.exit ?? 0 } : undefined;
            const args = normalizeArgs({ ...input, path: input.filePath ?? input.path, query: input.pattern, command: input.command });
            ev({ kind: "tool", id: p.callID ?? p.id, name, args, status: st.status === "error" ? "error" : "done", output: String(st.output ?? st.error ?? "").slice(0, 8000), meta });
            if (/edit|write|patch/.test(p.tool)) ctx.onFileChanged(".");
          } else if (j.type === "error") {
            const e = j.error?.data?.message ?? j.error?.message ?? JSON.stringify(j.error);
            failure = String(e);
            ev({ kind: "notice", text: `OpenCode: ${String(e).slice(0, 300)}` });
          }
        } else if (provider === "claude-code") {
          if (j.type === "system" && j.subtype === "init" && j.session_id) sessions.claude = j.session_id;
          if (j.type === "assistant") {
            for (const b of j.message?.content ?? []) {
              if (b.type === "text") { ev({ kind: "text", delta: b.text + "\n" }); finalText += b.text + "\n"; }
              if (b.type === "thinking" && b.thinking) ev({ kind: "reasoning", delta: b.thinking });
              if (b.type === "tool_use") ev({ kind: "tool", id: b.id, name: mapClaudeTool(b.name), args: normalizeArgs(b.input), status: "running" });
            }
          }
          if (j.type === "user") {
            for (const b of j.message?.content ?? []) {
              if (b.type === "tool_result") {
                const out = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : String(b.content ?? "");
                ev({ kind: "tool", id: b.tool_use_id, status: b.is_error ? "error" : "done", output: out.slice(0, 8000) });
              }
            }
            ctx.onFileChanged(".");
          }
          if (j.type === "result" && j.is_error) ev({ kind: "notice", text: String(j.result ?? "Claude Code reported an error") });
        } else {
          const it = j.item ?? j.msg ?? {};
          if (j.type === "item.completed" || j.type === "item.started") {
            const t = it.type ?? it.item_type;
            if (t === "agent_message" && j.type === "item.completed") { ev({ kind: "text", delta: (it.text ?? "") + "\n" }); finalText += it.text ?? ""; }
            else if (t === "reasoning" && j.type === "item.completed") ev({ kind: "reasoning", delta: it.text ?? "" });
            else if (t === "command_execution") ev({ kind: "tool", id: it.id, name: "run_command", args: { command: it.command }, status: j.type === "item.completed" ? (it.exit_code ? "error" : "done") : "running", output: it.aggregated_output?.slice(0, 8000), meta: j.type === "item.completed" ? { exitCode: it.exit_code ?? 0 } : undefined });
            else if (t === "file_change") { ev({ kind: "tool", id: it.id, name: "edit_file", args: { path: it.changes?.map((c: any) => c.path).join(", ") }, status: j.type === "item.completed" ? "done" : "running" }); ctx.onFileChanged("."); }
          }
          if (j.type === "error" || j.type === "turn.failed") ev({ kind: "notice", text: j.message ?? j.error?.message ?? "Codex error" });
        }
      };
      child.stdout.on("data", (d) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try { handle(JSON.parse(line)); } catch { /* non-JSON log line */ }
        }
      });
      child.stderr.on("data", (d) => { errBuf += d.toString(); });
      child.on("error", (e) => reject(new Error(`Could not start ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        s.messages.push({ role: "assistant", content: finalText });
        if (ctx.signal.aborted) resolve();
        else if (!finalText && (failure || code)) reject(new Error(failure || `${path.basename(cmd)} exited with code ${code}: ${errBuf.slice(-1500)}`));
        else resolve();
      });
    });
  } finally {
    if (before) await recordExternalChanges(before, ctx);
  }
}

function mapClaudeTool(n: string) {
  return ({ Read: "read_file", Edit: "edit_file", MultiEdit: "edit_file", Write: "write_file", Bash: "run_command", Grep: "grep", Glob: "find_files", LS: "list_dir" } as any)[n] ?? n;
}
function normalizeArgs(i: any = {}) {
  const root = getRoot();
  const p = i.file_path || i.path;
  return { ...i, ...(p ? { path: path.isAbsolute(p) ? path.relative(root, p) : p } : {}), ...(i.pattern && !i.query ? { query: i.pattern } : {}) };
}

/** One-shot helper used by inline edit, commit messages, etc. */
export async function quick(model: string, messages: Msg[], onText?: (d: string) => void, signal?: AbortSignal, fast = true) {
  const chain: string[] = model && model !== "auto" && !model.startsWith("ensemble/") && providerById(splitModel(model).provider)?.kind !== "cli"
    ? [model, ...(await pickModels(2, { preferFree: true, fast, exclude: [model] }))]
    : await pickModels(3, { preferFree: true, fast });
  // Every keyless API exhausted: OpenCode's free models still answer (slower).
  if (!chain.length) chain.push(...(await pickModels(2, { preferFree: true, includeAgents: true })));
  if (!chain.length) throw new Error("No models available. Add a free API key in Settings → Models or install OpenCode.");
  return chatWithFailover(chain, { messages, onText, signal });
}

export { chat };

/** Review pass when the executor was an external agent: report findings, no automatic fix loop. */
async function reviewOnly(s: Session, userText: string, pool: string[], judge: string, executor: string, rounds: number, ev: Emit, ctx: ToolContext, stage: (id: string, label: string, status: string, extra?: any) => void) {
  if (!rounds) return;
  const diff = await changesDiff(s);
  if (!diff.trim()) return;
  const reviewer = pool.find((m) => m !== executor) ?? judge;
  stage("review0", "Reviewing changes", "running", { model: reviewer });
  const rv = await chatWithFailover([reviewer, judge], {
    messages: [
      { role: "system", content: "You are a meticulous senior code reviewer. Find real bugs only. Ignore style nits." },
      { role: "user", content: `<request>\n${userText}\n</request>\n\n<diff>\n${diff.slice(0, 80_000)}\n</diff>\n\nIf the change is correct and complete, reply with exactly "LGTM". Otherwise list each concrete problem with file and line.` },
    ],
    signal: ctx.signal,
    onText: (d) => ev({ kind: "text", delta: d, stageId: "review0" }),
  });
  const lgtm = /^\s*LGTM\b/i.test(rv.text);
  stage("review0", lgtm ? "Review passed" : "Review found issues (see details)", "done", { model: rv.model, verdict: lgtm ? "pass" : "issues" });
}
