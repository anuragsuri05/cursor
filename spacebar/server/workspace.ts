import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSettings, saveSettings } from "./settings.js";

const exec = promisify(execFile);

const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "__pycache__", ".venv", "venv", ".DS_Store", ".turbo", "coverage", "target", ".idea"]);

let root = "";

export function getRoot() { return root; }

export function openWorkspace(dir: string) {
  const abs = path.resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  root = abs;
  const s = getSettings();
  saveSettings({ lastWorkspace: abs, recentWorkspaces: [abs, ...s.recentWorkspaces.filter((r) => r !== abs)].slice(0, 10) });
  return abs;
}

/** Resolve a workspace-relative (or absolute-inside-workspace) path; refuses to escape the workspace. */
export function resolveSafe(p: string): string {
  if (!root) throw new Error("No folder is open");
  // Models often write "/src/x.ts" meaning workspace-relative; only true absolute paths inside root are kept as-is.
  const abs = path.isAbsolute(p) && p.startsWith(root) ? path.resolve(p) : path.resolve(root, p.replace(/^\/+/, "") || ".");
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path is outside the workspace: ${p}`);
  return abs;
}

export const rel = (abs: string) => path.relative(root, abs) || ".";

export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }

export async function listDir(relPath = "."): Promise<TreeNode[]> {
  const abs = resolveSafe(relPath);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== ".DS_Store")
    .map((e) => ({ name: e.name, path: rel(path.join(abs, e.name)), type: (e.isDirectory() ? "dir" : "file") as "dir" | "file" }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

export async function walkFiles(limit = 20000): Promise<string[]> {
  if (!root) return [];
  try {
    const { stdout } = await exec("rg", ["--files", "--hidden", "-g", "!.git"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split("\n").filter(Boolean).slice(0, limit);
  } catch { /* rg missing — fall back to a manual walk */ }
  const out: string[] = [];
  const walk = async (dir: string) => {
    if (out.length >= limit) return;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (IGNORED.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(rel(p));
      if (out.length >= limit) return;
    }
  };
  await walk(root);
  return out;
}

export async function readFile(p: string) { return fsp.readFile(resolveSafe(p), "utf8"); }

export async function writeFile(p: string, content: string) {
  const abs = resolveSafe(p);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
}

export async function exists(p: string) { try { await fsp.access(resolveSafe(p)); return true; } catch { return false; } }

export interface SearchHit { path: string; line: number; text: string }

export async function search(query: string, opts: { regex?: boolean; caseSensitive?: boolean; glob?: string; max?: number } = {}): Promise<SearchHit[]> {
  if (!root || !query) return [];
  const max = opts.max ?? 500;
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-columns", "300", "-g", "!.git"];
  if (!opts.regex) args.push("--fixed-strings");
  if (!opts.caseSensitive) args.push("--smart-case");
  if (opts.glob) args.push("-g", opts.glob);
  args.push("--", query, ".");
  try {
    const { stdout } = await exec("rg", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    return parseHits(stdout, max);
  } catch (e: any) {
    if (e.code === 1) return [];
    if (e.stdout) return parseHits(e.stdout, max);
  }
  // Fallback: JS search
  const hits: SearchHit[] = [];
  const re = opts.regex ? new RegExp(query, opts.caseSensitive ? "" : "i") : null;
  for (const f of await walkFiles()) {
    let txt = "";
    try { txt = await readFile(f); } catch { continue; }
    txt.split("\n").forEach((l, i) => {
      if (hits.length < max && (re ? re.test(l) : opts.caseSensitive ? l.includes(query) : l.toLowerCase().includes(query.toLowerCase())))
        hits.push({ path: f, line: i + 1, text: l.slice(0, 300) });
    });
    if (hits.length >= max) break;
  }
  return hits;
}

function parseHits(stdout: string, max: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (m) hits.push({ path: m[1].replace(/^\.\//, ""), line: Number(m[2]), text: m[3] });
    if (hits.length >= max) break;
  }
  return hits;
}

export async function git(args: string[]) {
  const { stdout } = await exec("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function gitStatus() {
  try {
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const out = await git(["status", "--porcelain=v1", "-uall"]);
    const files = out.split("\n").filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim() || "?", path: l.slice(3).replace(/^"|"$/g, "") }));
    return { repo: true, branch, files };
  } catch {
    return { repo: false, branch: "", files: [] as { status: string; path: string }[] };
  }
}

/** Project rules: AGENTS.md, CLAUDE.md, .spacebar/rules/*, .cursor/rules/*.mdc (alwaysApply or matching globs), .cursorrules */
export async function loadRules(activeFiles: string[] = []): Promise<string> {
  if (!root) return "";
  const parts: string[] = [];
  const add = async (p: string, label = p) => {
    try { const t = (await fsp.readFile(path.join(root, p), "utf8")).trim(); if (t) parts.push(`### ${label}\n${t}`); } catch { /* missing */ }
  };
  await add("AGENTS.md");
  if (!parts.length) await add("CLAUDE.md");
  await add(".cursorrules");
  for (const dir of [".spacebar/rules", ".cursor/rules"]) {
    let files: string[] = [];
    try { files = (await fsp.readdir(path.join(root, dir), { recursive: true })) as string[]; } catch { continue; }
    for (const f of files.filter((f) => /\.(md|mdc)$/.test(f))) {
      const raw = await fsp.readFile(path.join(root, dir, f), "utf8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
      const body = fm ? raw.slice(fm[0].length) : raw;
      const meta = fm?.[1] ?? "";
      const always = /alwaysApply:\s*true/.test(meta) || !fm;
      const globs = meta.match(/globs:\s*(.+)/)?.[1]?.split(",").map((g) => g.trim().replace(/^["']|["']$/g, "")).filter(Boolean) ?? [];
      const desc = meta.match(/description:\s*(.+)/)?.[1]?.replace(/^["']|["']$/g, "");
      const matches = globs.some((g) => activeFiles.some((a) => path.matchesGlob(a, g)));
      if (always || matches) parts.push(`### ${dir}/${f}\n${body.trim()}`);
      else if (desc) parts.push(`### ${dir}/${f} (apply when relevant: ${desc})\n${body.trim()}`);
    }
  }
  return parts.join("\n\n");
}

export async function browse(dir?: string) {
  const abs = path.resolve(dir || process.env.HOME || "/");
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  return {
    path: abs,
    parent: path.dirname(abs),
    dirs: entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort(),
  };
}
