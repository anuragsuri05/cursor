import { chat, type Msg } from "./llm/chat.js";
import { pickModels, providerBaseURL, providerById, providerConfigured, providerKey, splitModel } from "./llm/providers.js";
import { getSettings } from "./settings.js";
import { quick } from "./agent/session.js";

// ---------------------------------------------------------------------------
// Tab: next-edit autocomplete

let tabChain: { at: number; models: string[] } | null = null;

async function tabModels(): Promise<string[]> {
  const pref = getSettings().tabModel;
  if (pref && pref !== "auto") return [pref];
  if (tabChain && Date.now() - tabChain.at < 5 * 60_000) return tabChain.models;
  const codestral = providerById("mistral")!;
  const models = providerConfigured(codestral) ? ["mistral/codestral-latest"] : [];
  models.push(...(await pickModels(3, { preferFree: true, fast: true })));
  tabChain = { at: Date.now(), models };
  return models;
}

export async function tabComplete(req: { path: string; language: string; prefix: string; suffix: string }, signal: AbortSignal): Promise<string> {
  const prefix = req.prefix.slice(-6000);
  const suffix = req.suffix.slice(0, 2000);
  for (const model of await tabModels()) {
    try {
      const { provider, model: id } = splitModel(model);
      let text: string;
      if (provider === "mistral" && /codestral/.test(id)) {
        const p = providerById("mistral")!;
        const res = await fetch(`${providerBaseURL(p)}/fim/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerKey(p)}` },
          body: JSON.stringify({ model: id, prompt: prefix, suffix, max_tokens: 256, temperature: 0, stop: ["\n\n\n"] }),
          signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const j: any = await res.json();
        text = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text ?? "";
      } else {
        const r = await chat({
          model, signal, maxTokens: 256, temperature: 0,
          messages: [
            { role: "system", content: "You are a code completion engine. Output ONLY the code to insert at <CURSOR>, with no explanation and no markdown fences. Complete the current line and, if natural, the rest of the current block (at most ~12 lines). Never repeat code that already exists after the cursor. If nothing should be inserted, output nothing." },
            { role: "user", content: `File: ${req.path} (${req.language})\n\n${prefix}<CURSOR>${suffix}` },
          ],
        });
        text = r.text;
      }
      return cleanCompletion(text, prefix, suffix);
    } catch (e: any) {
      if (signal.aborted) return "";
      continue;
    }
  }
  return "";
}

function cleanCompletion(text: string, prefix: string, suffix: string): string {
  let t = text.replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  t = t.replace(/<CURSOR>/g, "");
  // Cursor sits on an indented blank line: don't start with a newline.
  if (/\n[ \t]*$/.test(prefix) || /^[ \t]+$/.test(prefix.slice(prefix.lastIndexOf("\n") + 1))) t = t.replace(/^\n+[ \t]*/, "");
  // Drop an echoed copy of the current line's beginning.
  const lineStart = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (lineStart.trim() && t.startsWith(lineStart)) t = t.slice(lineStart.length);
  // Trim overlap with the suffix.
  const s = suffix.trimStart();
  for (let n = Math.min(t.length, s.length, 200); n > 3; n--) {
    if (t.endsWith(s.slice(0, n))) { t = t.slice(0, -n); break; }
  }
  return t.replace(/\s+$/, (m) => (m.includes("\n") ? "" : m));
}

// ---------------------------------------------------------------------------
// Cmd+K inline edit

export async function inlineEdit(
  req: { path: string; language: string; before: string; selection: string; after: string; instruction: string; model?: string },
  onText: (d: string) => void,
  signal: AbortSignal,
) {
  const generating = !req.selection.trim();
  const messages: Msg[] = [
    {
      role: "system",
      content: `You are an expert programmer editing code inside an editor. ${generating ? "Write new code to insert at the cursor" : "Rewrite the selected code"} according to the instruction.
Output ONLY the ${generating ? "code to insert" : "replacement code for the selection"} — no explanations, no markdown fences. Preserve the surrounding indentation style.`,
    },
    {
      role: "user",
      content: `File: ${req.path} (${req.language})

<code_before>
${req.before.slice(-8000)}
</code_before>
<selection>
${req.selection}
</selection>
<code_after>
${req.after.slice(0, 4000)}
</code_after>

Instruction: ${req.instruction}`,
    },
  ];
  let started = false;
  let buf = "";
  // Strip a leading ``` fence if the model adds one anyway.
  const r = await quick(req.model ?? getSettings().defaultModel, messages, (d) => {
    if (!started) {
      buf += d;
      if (buf.length < 12 && !buf.includes("\n")) return;
      started = true;
      d = buf.replace(/^\s*```[\w-]*\n/, "");
    }
    onText(d);
  }, signal, false);
  if (!started && buf) onText(buf.replace(/^\s*```[\w-]*\n/, ""));
  return r.text.replace(/^\s*```[\w-]*\n/, "").replace(/\n?```\s*$/, "");
}

export async function commitMessage(diff: string): Promise<string> {
  const r = await quick(getSettings().defaultModel, [
    { role: "system", content: "Write a concise conventional git commit message for this diff: a subject line under 72 characters, then (only if useful) a blank line and 1-4 bullet points. Output only the message." },
    { role: "user", content: diff.slice(0, 60_000) },
  ]);
  return r.text.trim().replace(/^```\w*\n?|```$/g, "");
}

/** "Apply" a code block from chat to a file: a fast model merges the snippet into the full file. */
export async function applySnippet(req: { path: string; original: string; snippet: string; model?: string }): Promise<string> {
  if (!req.original.trim()) return req.snippet;
  const r = await quick(req.model ?? getSettings().defaultModel, [
    { role: "system", content: "You merge a code change into a file. The snippet may be partial and use comments like '// ... existing code ...' for unchanged regions. Output the COMPLETE updated file and nothing else — no markdown fences, no commentary. Keep every unrelated line exactly as it was." },
    { role: "user", content: `<file path="${req.path}">\n${req.original}\n</file>\n\n<change>\n${req.snippet}\n</change>` },
  ], undefined, undefined, true);
  return r.text.replace(/^\s*```[\w-]*\n/, "").replace(/\n?```\s*$/, "");
}
