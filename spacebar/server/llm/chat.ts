import Anthropic from "@anthropic-ai/sdk";
import { cliPath, coolingDown, noteRateLimit, providerBaseURL, providerById, providerKey, splitModel } from "./providers.js";
import { spawn } from "node:child_process";
import { getRoot } from "../workspace.js";

export interface ToolCall { id: string; name: string; arguments: string }
export interface ToolDef { name: string; description: string; parameters: any }

export interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  images?: string[]; // data URLs
  /** Provider-native assistant content, replayed unchanged to the same model (keeps Claude thinking blocks valid). */
  raw?: { model: string; content: any };
}

export interface ChatOpts {
  model: string; // provider/model
  messages: Msg[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface ChatResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finish: string;
  model: string;
  raw?: Msg["raw"];
  usage?: { input: number; output: number };
}

export class LLMError extends Error {
  constructor(message: string, public status = 0, public retryable = false) { super(message); }
}

/** Models (provider/model) that rejected native tool calls; they use the text tool protocol instead. */
const noNativeTools = new Set<string>();

export async function chat(opts: ChatOpts): Promise<ChatResult> {
  const { provider } = splitModel(opts.model);
  const p = providerById(provider);
  if (!p) throw new LLMError(`Unknown provider "${provider}"`);
  if (p.kind === "anthropic") return anthropicChat(opts);
  if (p.id === "opencode" && !opts.tools?.length) return openCodePlanChat(opts);
  if (p.kind === "cli") throw new LLMError(`${p.name} is a coding agent, not a chat model`);
  if (opts.tools?.length && noNativeTools.has(opts.model)) return textToolChat(opts);
  try {
    return await openaiChat(opts);
  } catch (e: any) {
    const msg = String(e.message || "");
    if (opts.tools?.length && e.status >= 400 && e.status < 500 && e.status !== 429 && /tool|function/i.test(msg)) {
      noNativeTools.add(opts.model);
      return textToolChat(opts);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter, Groq, Gemini, Cerebras, Mistral, GitHub, NVIDIA, Ollama, OpenAI, …)

function toOpenAIMessages(msgs: Msg[]) {
  return msgs.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content || "(empty)" };
    if (m.role === "assistant") {
      const o: any = { role: "assistant", content: m.content || (m.tool_calls?.length ? null : "") };
      if (m.tool_calls?.length) o.tool_calls = m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments || "{}" } }));
      return o;
    }
    if (m.role === "user" && m.images?.length) {
      return { role: "user", content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))] };
    }
    return { role: m.role, content: m.content };
  });
}

async function openaiChat(opts: ChatOpts): Promise<ChatResult> {
  const { provider, model } = splitModel(opts.model);
  const p = providerById(provider)!;
  const key = providerKey(p);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (provider === "openrouter") { headers["HTTP-Referer"] = "https://github.com/spacebar"; headers["X-Title"] = "Spacebar IDE"; }

  const body: any = { model, messages: toOpenAIMessages(opts.messages), stream: true };
  if (opts.tools?.length) body.tools = opts.tools.map((t) => ({ type: "function", function: t }));
  if (opts.maxTokens) body[provider === "openai" ? "max_completion_tokens" : "max_tokens"] = opts.maxTokens;
  if (opts.temperature !== undefined && provider !== "openai") body.temperature = opts.temperature;
  if (provider !== "gemini" && provider !== "github") body.stream_options = { include_usage: true };

  const res = await fetch(`${providerBaseURL(p)}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new LLMError(`${p.name} ${res.status}: ${text.slice(0, 400)}`, res.status, res.status === 429 || res.status >= 500 || res.status === 408);
  }

  let text = "", reasoning = "", finish = "stop";
  let usage: ChatResult["usage"];
  const calls: { id: string; name: string; arguments: string }[] = [];
  // Some models (DeepSeek R1, Qwen3 on Ollama) emit reasoning inline as <think>…</think>.
  let inThink = false, pending = "";

  const emitContent = (chunk: string) => {
    pending += chunk;
    while (pending) {
      if (inThink) {
        const end = pending.indexOf("</think>");
        if (end < 0) { if (pending.length > 8) { const s = pending.slice(0, -8); reasoning += s; opts.onReasoning?.(s); pending = pending.slice(-8); } return; }
        const s = pending.slice(0, end); reasoning += s; opts.onReasoning?.(s);
        pending = pending.slice(end + 8); inThink = false;
      } else {
        const start = pending.indexOf("<think>");
        if (start < 0) {
          const keep = pending.lastIndexOf("<") > pending.length - 8 ? pending.length - pending.lastIndexOf("<") : 0;
          const s = pending.slice(0, pending.length - keep);
          if (s) { text += s; opts.onText?.(s); }
          pending = pending.slice(pending.length - keep);
          return;
        }
        const s = pending.slice(0, start); if (s) { text += s; opts.onText?.(s); }
        pending = pending.slice(start + 7); inThink = true;
      }
    }
  };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new LLMError(`${p.name}: ${j.error.message || JSON.stringify(j.error)}`, j.error.code || 500, true);
      if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta ?? {};
      const r = d.reasoning_content ?? d.reasoning;
      if (typeof r === "string" && r) { reasoning += r; opts.onReasoning?.(r); }
      if (typeof d.content === "string" && d.content) emitContent(d.content);
      for (const tc of d.tool_calls ?? []) {
        const idx = tc.index ?? calls.length;
        calls[idx] ??= { id: tc.id || `call_${Date.now()}_${idx}`, name: "", arguments: "" };
        if (tc.id) calls[idx].id = tc.id;
        if (tc.function?.name) calls[idx].name += tc.function.name;
        if (tc.function?.arguments) calls[idx].arguments += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  if (pending) { if (inThink) reasoning += pending; else { text += pending; opts.onText?.(pending); } }
  return { text, reasoning, toolCalls: calls.filter(Boolean).filter((c) => c.name), finish, model: opts.model, usage };
}

// ---------------------------------------------------------------------------
// Text tool protocol, for free/local models without native function calling.

function textToolSystem(tools: ToolDef[]): string {
  return [
    "## Tools",
    "You can call tools. To call one, output EXACTLY this block (one per call, nothing after it until you get the result):",
    '<tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>',
    "Tool results come back in a user message starting with <tool_result>. When the task is done, answer normally without a tool_call.",
    "Available tools:",
    ...tools.map((t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters.properties)} required: ${JSON.stringify(t.parameters.required ?? [])}`),
  ].join("\n");
}

async function textToolChat(opts: ChatOpts): Promise<ChatResult> {
  const sys = textToolSystem(opts.tools!);
  const msgs: Msg[] = [];
  for (const m of opts.messages) {
    if (m.role === "system") msgs.push({ role: "system", content: `${m.content}\n\n${sys}` });
    else if (m.role === "tool") msgs.push({ role: "user", content: `<tool_result name="${m.name}">\n${m.content}\n</tool_result>` });
    else if (m.role === "assistant" && m.tool_calls?.length)
      msgs.push({ role: "assistant", content: `${m.content}\n${m.tool_calls.map((t) => `<tool_call>{"name": "${t.name}", "arguments": ${t.arguments || "{}"}}</tool_call>`).join("\n")}` });
    else msgs.push({ ...m, tool_calls: undefined });
  }
  if (!msgs.some((m) => m.role === "system")) msgs.unshift({ role: "system", content: sys });

  // Stream visible text, but hold back anything that looks like a tool call.
  let held = "";
  let hidden = false;
  const r = await openaiChat({
    ...opts, tools: undefined, messages: msgs,
    onText: (d) => {
      if (hidden) return;
      held += d;
      const i = held.indexOf("<tool_call>");
      if (i >= 0) { hidden = true; if (i > 0) opts.onText?.(held.slice(0, i)); held = ""; return; }
      const lt = held.lastIndexOf("<");
      if (lt >= 0 && held.length - lt < 12) { if (lt > 0) { opts.onText?.(held.slice(0, lt)); held = held.slice(lt); } return; }
      opts.onText?.(held); held = "";
    },
  });
  if (!hidden && held) opts.onText?.(held);

  const toolCalls: ToolCall[] = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.text))) {
    try {
      const j = JSON.parse(m[1].replace(/^```(json)?|```$/g, ""));
      toolCalls.push({ id: `tc_${Date.now()}_${toolCalls.length}`, name: j.name, arguments: JSON.stringify(j.arguments ?? {}) });
    } catch { /* ignore malformed */ }
  }
  const text = r.text.replace(re, "").replace(/<tool_call>[\s\S]*$/, "").trim();
  return { ...r, text, toolCalls };
}

// ---------------------------------------------------------------------------
// Anthropic (official SDK)

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

function toAnthropic(msgs: Msg[], model: string) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: m.tool_call_id!, content: m.content || "(empty)" };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && (last.content as any[])[0]?.type === "tool_result") (last.content as any[]).push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }
    if (m.role === "assistant") {
      if (m.raw && m.raw.model === model) { out.push({ role: "assistant", content: m.raw.content }); continue; }
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const t of m.tool_calls ?? []) {
        let input: any = {};
        try { input = JSON.parse(t.arguments || "{}"); } catch { /* keep empty */ }
        content.push({ type: "tool_use", id: t.id, name: t.name, input });
      }
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "(no output)" }] });
      continue;
    }
    if (m.images?.length) {
      out.push({
        role: "user",
        content: [
          ...m.images.map((url) => {
            const [, mediaType, data] = url.match(/^data:(image\/\w+);base64,(.*)$/) ?? [];
            return { type: "image", source: { type: "base64", media_type: mediaType, data } } as any;
          }),
          { type: "text", text: m.content },
        ],
      });
    } else out.push({ role: "user", content: m.content });
  }
  return { system, messages: out };
}

async function anthropicChat(opts: ChatOpts): Promise<ChatResult> {
  const { model } = splitModel(opts.model);
  const p = providerById("anthropic")!;
  const client = new Anthropic({ apiKey: providerKey(p) });
  const { system, messages } = toAnthropic(opts.messages, model);
  const params: any = {
    model,
    max_tokens: opts.maxTokens ?? 64000,
    messages,
    ...(system ? { system } : {}),
    ...(opts.tools?.length
      ? { tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true })) }
      : {}),
  };
  // Server-side refusal fallback on the models that support it.
  if (FALLBACK_MODELS.has(model)) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }

  let text = "";
  const stream = params.betas ? client.beta.messages.stream(params, { signal: opts.signal }) : client.messages.stream(params, { signal: opts.signal });
  (stream as any).on("text", (d: string) => { text += d; opts.onText?.(d); });
  let final: any;
  try {
    final = await (stream as any).finalMessage();
  } catch (e: any) {
    if (e instanceof Anthropic.APIError) {
      const status = (e as any).status ?? 0;
      throw new LLMError(`Anthropic ${status}: ${e.message}`, status, status === 429 || status >= 500 || status === 529);
    }
    throw new LLMError(`Anthropic stream error: ${e.message}`, 0, true);
  }
  if (final.stop_reason === "refusal") {
    const note = "\n\n_(The model declined this request.)_";
    opts.onText?.(note);
    return { text: text + note, reasoning: "", toolCalls: [], finish: "refusal", model: opts.model };
  }
  const toolCalls: ToolCall[] = final.stop_reason === "max_tokens" ? [] : final.content
    .filter((b: any) => b.type === "tool_use")
    .map((b: any) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) }));
  return {
    text, reasoning: "", toolCalls, finish: final.stop_reason, model: opts.model,
    raw: { model, content: final.content },
    usage: { input: final.usage?.input_tokens ?? 0, output: final.usage?.output_tokens ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Failover: try a list of models in order, moving on when one is rate-limited or down.

export async function chatWithFailover(
  models: string[],
  opts: Omit<ChatOpts, "model">,
  onSwitch?: (from: string, to: string, why: string) => void,
): Promise<ChatResult> {
  let lastErr: any;
  // Skip models still cooling down after a rate limit, unless nothing else is left.
  const fresh = models.filter((m) => !coolingDown(m));
  if (fresh.length) models = fresh;
  for (let i = 0; i < models.length; i++) {
    let started = false;
    try {
      return await chat({
        ...opts, model: models[i],
        onText: (d) => { started = true; opts.onText?.(d); },
        onReasoning: (d) => { started = true; opts.onReasoning?.(d); },
      });
    } catch (e: any) {
      lastErr = e;
      if (opts.signal?.aborted) throw e;
      if (e.status === 429 || /rate limit|quota/i.test(String(e.message))) noteRateLimit(models[i], String(e.message));
      // Once text has streamed to the user, switching models would duplicate output.
      if (started || i === models.length - 1) throw e;
      onSwitch?.(models[i], models[i + 1], e.message);
    }
  }
  throw lastErr;
}

/** Non-streaming convenience wrapper. */
export async function complete(model: string | string[], messages: Msg[], extra: Partial<ChatOpts> = {}): Promise<string> {
  const models = Array.isArray(model) ? model : [model];
  const r = await chatWithFailover(models, { messages, ...extra });
  return r.text;
}

// ---------------------------------------------------------------------------
// OpenCode free models for text-only roles (ensemble drafts, synthesis, review).
// OpenCode only allows its free tier from its own agents, so this runs OpenCode's stock, read-only
// "plan" agent in the workspace and passes the task as the user message.


async function openCodePlanChat(opts: ChatOpts): Promise<ChatResult> {
  const { model } = splitModel(opts.model);
  const sys = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const convo = opts.messages.filter((m) => m.role !== "system")
    .map((m) => (m.role === "user" ? m.content : `[previous assistant reply]\n${m.content}`)).join("\n\n");
  // Keep the instructions short: OpenCode's plan agent already knows how to explore the repo.
  const brief = sys.length > 4000 ? sys.slice(sys.indexOf("<guidelines>") >= 0 ? sys.indexOf("<guidelines>") : 0, (sys.indexOf("<guidelines>") >= 0 ? sys.indexOf("<guidelines>") : 0) + 2000) : sys;
  const prompt = `${brief ? `Instructions:\n${brief}\n\n` : ""}${convo}`;
  const cwd = getRoot() || process.cwd();
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath("opencode") ?? "opencode", ["run", "--format", "json", "--dir", cwd, "-m", `opencode/${model}`, "--agent", "plan", prompt], {
      cwd, env: { ...process.env, PWD: cwd }, stdio: ["ignore", "pipe", "pipe"],
    });
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    let buf = "", text = "", failure = "", errBuf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        let j: any;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.type === "text" && j.part?.text) { const t = (text ? "\n\n" : "") + j.part.text; text += t; opts.onText?.(t); }
        else if (j.type === "error") failure = String(j.error?.data?.message ?? j.error?.message ?? "OpenCode error");
      }
    });
    child.stderr.on("data", (d) => { errBuf += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(new LLMError(`Could not start OpenCode: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (text) resolve({ text, reasoning: "", toolCalls: [], finish: "stop", model: opts.model });
      else reject(new LLMError(`OpenCode ${model}: ${failure || errBuf.slice(-400) || `exited with code ${code}`}`, /rate|quota|429/i.test(failure) ? 429 : 0, true));
    });
  });
}
