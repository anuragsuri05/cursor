import os from "node:os";
import path from "node:path";
import { getRoot, gitStatus, loadRules, walkFiles } from "../workspace.js";
import { getSettings } from "../settings.js";

export type Mode = "agent" | "ask" | "plan";

export async function systemPrompt(mode: Mode, activeFiles: string[]): Promise<string> {
  const root = getRoot();
  const git = await gitStatus();
  const rules = await loadRules(activeFiles);
  const userRules = getSettings().userRules.trim();
  const files = await walkFiles(400).catch(() => [] as string[]);
  const tree = files.length ? files.slice(0, 250).join("\n") + (files.length > 250 ? `\n… and ${files.length - 250} more files` : "") : "(empty)";

  const modeText: Record<Mode, string> = {
    agent: `You are in AGENT mode. Complete the user's task end to end by using tools: explore the code, make the edits, and verify them (run the build/tests/linter when one exists). Don't stop to ask for permission for routine steps. Keep going until the task is fully done, then give a short summary of what changed.`,
    ask: `You are in ASK mode (read-only). Answer the user's question using the read-only tools to look at the code. Do not attempt to modify files. Cite files as \`path:line\`.`,
    plan: `You are in PLAN mode (read-only). Research the codebase with the read-only tools, then write a concrete implementation plan in Markdown: a one-paragraph summary, then "## Changes" listing each file and what changes in it, then "## Steps" as a checklist, then "## Verification". Do not modify files. Ask clarifying questions only if the request is genuinely ambiguous.`,
  };

  return `You are Spacebar, an expert AI pair programmer working inside the user's code editor.

${modeText[mode]}

<environment>
OS: ${os.type()} ${os.release()} (${process.platform})
Workspace root: ${root} (name: ${path.basename(root)})
${git.repo ? `Git branch: ${git.branch}; ${git.files.length} changed files` : "Not a git repository"}
Today: ${new Date().toISOString().slice(0, 10)}
</environment>

<workspace_files>
${tree}
</workspace_files>

<guidelines>
- All paths are relative to the workspace root.
- Read a file before editing it. Make edits with edit_file using an exact, unique old_string; use write_file only for new files or full rewrites.
- Match the existing code style, naming and comment density. Don't add unrelated changes.
- Prefer small, verifiable steps. After editing, run the relevant build/test command if the project has one.
- When you reference code in your answer, use \`path:line\` and fenced code blocks with a language tag.
- Be concise. No filler.
</guidelines>
${rules ? `\n<project_rules>\n${rules}\n</project_rules>\n` : ""}${userRules ? `\n<user_rules>\n${userRules}\n</user_rules>\n` : ""}`;
}

export function contextBlock(ctx: ChatContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.currentFile) parts.push(`Currently open file: ${ctx.currentFile}${ctx.cursorLine ? ` (cursor at line ${ctx.cursorLine})` : ""}`);
  for (const f of ctx.files ?? []) parts.push(`<file path="${f.path}">\n${f.content}\n</file>`);
  if (ctx.selection) parts.push(`<selection path="${ctx.selection.path}" lines="${ctx.selection.startLine}-${ctx.selection.endLine}">\n${ctx.selection.text}\n</selection>`);
  if (ctx.terminal) parts.push(`<terminal_output>\n${ctx.terminal}\n</terminal_output>`);
  return parts.length ? `<attached_context>\n${parts.join("\n\n")}\n</attached_context>\n\n` : "";
}

export interface ChatContext {
  currentFile?: string;
  cursorLine?: number;
  files?: { path: string; content: string }[];
  selection?: { path: string; startLine: number; endLine: number; text: string };
  terminal?: string;
  images?: string[];
}
