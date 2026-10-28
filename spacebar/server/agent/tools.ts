import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ToolDef } from "../llm/chat.js";
import { getRoot, listDir, readFile, resolveSafe, search, walkFiles, writeFile, exists } from "../workspace.js";
import { getSettings } from "../settings.js";

export interface ToolContext {
  /** Record the original content of a file before the agent first touches it (null = file did not exist). */
  checkpoint: (path: string, original: string | null) => void;
  approve: (req: { kind: "command"; command: string }) => Promise<boolean>;
  onFileChanged: (path: string) => void;
  signal: AbortSignal;
}

const obj = (properties: any, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

export const READ_TOOLS: ToolDef[] = [
  {
    name: "list_dir",
    description: "List files and folders in a workspace directory.",
    parameters: obj({ path: { type: "string", description: "Workspace-relative directory, '.' for root" } }, ["path"]),
  },
  {
    name: "read_file",
    description: "Read a file. Returns numbered lines. For large files, read a range with start_line/end_line.",
    parameters: obj({
      path: { type: "string" },
      start_line: { type: "integer", description: "1-based, optional" },
      end_line: { type: "integer", description: "inclusive, optional" },
    }, ["path"]),
  },
  {
    name: "grep",
    description: "Search file contents across the workspace (ripgrep). Returns path:line: text.",
    parameters: obj({
      query: { type: "string" },
      regex: { type: "boolean", description: "Treat query as a regex" },
      glob: { type: "string", description: "Optional file glob filter, e.g. '*.ts'" },
    }, ["query"]),
  },
  {
    name: "find_files",
    description: "Find files whose path contains the given text (fuzzy filename search).",
    parameters: obj({ pattern: { type: "string" } }, ["pattern"]),
  },
];

export const WRITE_TOOLS: ToolDef[] = [
  {
    name: "edit_file",
    description: "Replace an exact snippet in a file. old_string must match the file exactly (including whitespace) and be unique; include surrounding lines to make it unique. Use an empty old_string to create a new file.",
    parameters: obj({
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    }, ["path", "old_string", "new_string"]),
  },
  {
    name: "write_file",
    description: "Create or overwrite a whole file. Prefer edit_file for small changes to existing files.",
    parameters: obj({ path: { type: "string" }, content: { type: "string" }, overwrite: { type: "boolean", description: "Set true when intentionally rewriting most of an existing file" } }, ["path", "content"]),
  },
  {
    name: "delete_file",
    description: "Delete a file from the workspace.",
    parameters: obj({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "run_command",
    description: "Run a shell command in the workspace root (build, test, lint, git, package managers). Returns stdout/stderr. Avoid long-running servers.",
    parameters: obj({
      command: { type: "string" },
      timeout_seconds: { type: "integer", description: "Default 120" },
    }, ["command"]),
  },
];

const MAX_OUT = 30_000;
const clip = (s: string, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars truncated)` : s);

export function commandAllowed(cmd: string): "allow" | "ask" | "deny" {
  const { runMode, allowlist, denylist } = getSettings().agent;
  if (denylist.some((d) => d && cmd.includes(d))) return "deny";
  if (runMode === "auto") return "allow";
  if (runMode === "allowlist") {
    // Every segment of a compound command must be allowlisted.
    const segs = cmd.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
    if (segs.length && segs.every((s) => allowlist.some((a) => s === a || s.startsWith(a + " ")))) return "allow";
  }
  return "ask";
}

/** If a model guesses a wrong directory, fall back to the unique file with the same name. */
async function fixPath(p: unknown): Promise<string> {
  if (typeof p !== "string" || !p) throw new Error("path is required");
  if (await exists(p)) return p;
  const base = path.basename(p);
  const matches = (await walkFiles()).filter((f) => path.basename(f) === base);
  return matches.length === 1 ? matches[0] : p;
}

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ output: string; meta?: any }> {
  let a: any;
  try { a = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { output: `Error: arguments were not valid JSON: ${rawArgs.slice(0, 200)}` }; }
  try {
    if (["read_file", "delete_file"].includes(name) || (name === "edit_file" && a.old_string)) a.path = await fixPath(a.path);
    switch (name) {
      case "list_dir": {
        const items = await listDir(a.path || ".");
        return { output: items.map((i) => (i.type === "dir" ? i.path + "/" : i.path)).join("\n") || "(empty)" };
      }
      case "read_file": {
        if (typeof a.path !== "string") throw new Error("path is required");
        const lines = (await readFile(a.path)).split("\n");
        const s = Math.max(1, a.start_line ?? 1);
        const e = Math.min(lines.length, a.end_line ?? Math.min(lines.length, s + 799));
        const body = lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(5)}  ${l}`).join("\n");
        const more = e < lines.length ? `\n… file has ${lines.length} lines; read more with start_line=${e + 1}` : "";
        return { output: clip(body + more), meta: { lines: e - s + 1, start: s, end: e } };
      }
      case "grep": {
        const hits = await search(a.query, { regex: !!a.regex, glob: a.glob, max: 200 });
        return { output: hits.map((h) => `${h.path}:${h.line}: ${h.text.trim()}`).join("\n") || "No matches.", meta: { count: hits.length } };
      }
      case "find_files": {
        // Accept plain text, globs or regex-escaped names (weak models often send "math\\.js" or "**/*.ts").
        const raw = String(a.pattern || "").replace(/\\(.)/g, "$1");
        const all = await walkFiles();
        let files = /[*?]/.test(raw) ? all.filter((f) => path.matchesGlob(f, raw) || path.matchesGlob(path.basename(f), raw)) : [];
        if (!files.length) {
          const q = raw.toLowerCase().replace(/[*?]/g, "");
          files = all.filter((f) => f.toLowerCase().includes(q));
        }
        files = files.slice(0, 100);
        return { output: files.join("\n") || "No files found.", meta: { count: files.length } };
      }
      case "edit_file": {
        const p = a.path as string;
        const isNew = !(await exists(p));
        const original = isNew ? null : await readFile(p);
        if (a.old_string === "" || a.old_string == null) {
          if (!isNew && original!.trim()) throw new Error("old_string is empty but the file already exists; provide the exact text to replace or use write_file");
          ctx.checkpoint(p, original);
          await writeFile(p, a.new_string);
          ctx.onFileChanged(p);
          return { output: `Created ${p}`, meta: diffStat(original ?? "", a.new_string) };
        }
        if (original === null) throw new Error(`File not found: ${p}`);
        const located = locate(original, a.old_string, a.new_string);
        if ("error" in located) throw new Error(located.error.replace("$FILE", p));
        const updated = original.slice(0, located.start) + located.replacement + original.slice(located.end);
        ctx.checkpoint(p, original);
        await writeFile(p, updated);
        ctx.onFileChanged(p);
        return { output: `Edited ${p}${located.note ? ` (${located.note})` : ""}`, meta: diffStat(original, updated) };
      }
      case "write_file": {
        const p = a.path as string;
        const original = (await exists(p)) ? await readFile(p) : null;
        if (original && !a.overwrite) {
          // Guard against models replacing a whole file with a fragment.
          const keep = new Set(String(a.content ?? "").split("\n").map((l) => l.trim()));
          const lines = original.split("\n").map((l) => l.trim()).filter(Boolean);
          const lost = lines.filter((l) => !keep.has(l)).length;
          if (lines.length >= 3 && lost / lines.length > 0.5) {
            throw new Error(`write_file would remove ${lost} of ${lines.length} lines of ${p}. Use edit_file for partial changes, or pass the COMPLETE new file content with "overwrite": true if a full rewrite is intended.`);
          }
        }
        ctx.checkpoint(p, original);
        await writeFile(p, a.content ?? "");
        ctx.onFileChanged(p);
        return { output: `${original === null ? "Created" : "Wrote"} ${p}`, meta: diffStat(original ?? "", a.content ?? "") };
      }
      case "delete_file": {
        const p = a.path as string;
        const original = await readFile(p);
        ctx.checkpoint(p, original);
        await fsp.unlink(resolveSafe(p));
        ctx.onFileChanged(p);
        return { output: `Deleted ${p}`, meta: { added: 0, removed: original.split("\n").length } };
      }
      case "run_command": {
        const cmd = String(a.command || "");
        const policy = commandAllowed(cmd);
        if (policy === "deny") return { output: `Command blocked by the denylist: ${cmd}`, meta: { blocked: true } };
        if (policy === "ask" && !(await ctx.approve({ kind: "command", command: cmd }))) {
          return { output: "The user skipped this command. Continue without running it, or ask the user how to proceed.", meta: { skipped: true } };
        }
        const r = await shell(cmd, (a.timeout_seconds ?? 120) * 1000, ctx.signal);
        return { output: clip(`exit code: ${r.code}\n${r.out}`), meta: { exitCode: r.code } };
      }
      default:
        return { output: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { output: `Error: ${e.message}`, meta: { error: true } };
  }
}

function diffStat(a: string, b: string) {
  const A = a ? a.split("\n") : [], B = b ? b.split("\n") : [];
  // Cheap line-multiset diff, good enough for "+12 -3" badges.
  const count = new Map<string, number>();
  for (const l of A) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of B) { const c = count.get(l) ?? 0; if (c > 0) count.set(l, c - 1); else added++; }
  let removed = 0;
  for (const c of count.values()) removed += c;
  return { added, removed };
}

export function shell(cmd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", cmd], { cwd: getRoot(), env: { ...process.env, PWD: getRoot(), CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    const onData = (d: Buffer) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-200_000); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const kill = () => child.kill("SIGTERM");
    const timer = setTimeout(() => { out += `\n(timed out after ${timeoutMs / 1000}s)`; kill(); }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
}

const LINE_NO = /^\s*\d+(?:\s{2}|\t|: ?|\| ?)/;

/**
 * Find old_string in the file, tolerating the mistakes weaker models make:
 * copied line-number prefixes, trailing whitespace/CRLF, and different indentation.
 * Only accepts a match when it is unique.
 */
function locate(file: string, oldStr: string, newStr: string): { start: number; end: number; replacement: string; note?: string } | { error: string } {
  const count = (h: string, n: string) => (n ? h.split(n).length - 1 : 0);
  const exact = count(file, oldStr);
  if (exact === 1) { const i = file.indexOf(oldStr); return { start: i, end: i + oldStr.length, replacement: newStr }; }
  if (exact > 1) return { error: `old_string matches ${exact} places in $FILE; include more surrounding lines to make it unique.` };

  // 1. Strip "  12  " line-number prefixes copied from read_file output.
  const oldLines = oldStr.split("\n");
  if (oldLines.filter((l) => l.trim()).every((l) => LINE_NO.test(l))) {
    const strip = (t: string) => t.split("\n").map((l) => l.replace(LINE_NO, "")).join("\n");
    const o = strip(oldStr);
    const n = newStr.split("\n").filter((l) => l.trim()).every((l) => LINE_NO.test(l)) ? strip(newStr) : newStr;
    if (count(file, o) === 1) { const i = file.indexOf(o); return { start: i, end: i + o.length, replacement: n, note: "ignored copied line numbers" }; }
    return locate(file, o, n);
  }

  // 2. Line-wise match ignoring indentation and trailing whitespace.
  const fl = file.split("\n");
  const ol = oldStr.replace(/\r\n/g, "\n").split("\n");
  while (ol.length && !ol[0].trim()) ol.shift();
  while (ol.length && !ol[ol.length - 1].trim()) ol.pop();
  if (!ol.length) return { error: "old_string is empty." };
  const norm = (l: string) => l.trim().replace(/\s+/g, " ");
  const hits: number[] = [];
  for (let i = 0; i + ol.length <= fl.length; i++) {
    let ok = true;
    for (let j = 0; j < ol.length && ok; j++) ok = norm(fl[i + j]) === norm(ol[j]);
    if (ok) hits.push(i);
  }
  if (hits.length === 1) {
    const i = hits[0];
    const offsets = [0];
    for (const l of fl) offsets.push(offsets[offsets.length - 1] + l.length + 1);
    // Re-indent the replacement to the file's indentation at the match.
    const fileIndent = fl[i].match(/^\s*/)![0];
    const oldIndent = ol[0].match(/^\s*/)![0];
    const repl = newStr.replace(/^\n+|\n+$/g, "").split("\n")
      .map((l) => (l.startsWith(oldIndent) ? fileIndent + l.slice(oldIndent.length) : l)).join("\n");
    return { start: offsets[i], end: offsets[i + ol.length] - 1, replacement: repl, note: "matched ignoring whitespace" };
  }
  if (hits.length > 1) return { error: `old_string matches ${hits.length} places in $FILE (ignoring whitespace); include more surrounding lines.` };
  return { error: `old_string not found in $FILE. Read the file again and copy the exact text (without line numbers).` };
}
