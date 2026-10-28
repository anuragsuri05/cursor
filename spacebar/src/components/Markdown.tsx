import { memo, useEffect, useMemo, useRef, useState } from "react";
import { marked, type Token } from "marked";
import DOMPurify from "dompurify";
import * as monaco from "monaco-editor";
import { api } from "../lib/api";
import { activeEditorPath, ensureModel, openDiff, openFile } from "../lib/actions";
import { getState, toast } from "../lib/store";
import { FileIcon, Icon, Spinner } from "./small";

marked.setOptions({ gfm: true, breaks: false });

const LANG_ALIASES: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", sh: "shell", bash: "shell", zsh: "shell", yml: "yaml", md: "markdown", rs: "rust", golang: "go", "c++": "cpp", cs: "csharp", rb: "ruby", kt: "kotlin" };

/** Parse "```ts path=src/a.ts", "```ts:src/a.ts" or "```src/a.ts" info strings. */
function parseInfo(info: string): { lang: string; path?: string } {
  const [first = "", ...rest] = info.trim().split(/\s+/);
  let lang = first, path: string | undefined;
  if (first.includes(":")) [lang, path] = first.split(/:(.*)/s);
  const attr = rest.join(" ").match(/(?:path|file)=["']?([^"'\s]+)/);
  if (attr) path = attr[1];
  if (!path && /[\/.]/.test(first) && first.includes(".") && !first.startsWith(".")) { path = first; lang = first.split(".").pop()!; }
  if (!path && rest[0] && /\.\w+$/.test(rest[0])) path = rest[0];
  return { lang: LANG_ALIASES[lang?.toLowerCase()] ?? lang?.toLowerCase() ?? "", path };
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const tokens = useMemo(() => marked.lexer(text), [text]);
  const groups: (Token[] | Token)[] = [];
  for (const t of tokens) {
    if (t.type === "code") groups.push(t);
    else if (Array.isArray(groups[groups.length - 1])) (groups[groups.length - 1] as Token[]).push(t);
    else groups.push([t]);
  }
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "A") { e.preventDefault(); window.open((el as HTMLAnchorElement).href, "_blank"); return; }
    if (el.tagName !== "CODE") return;
    const m = el.textContent?.match(/^([\w./@-]+\.\w+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!m) return;
    const files = getState().files;
    const p = files.includes(m[1]) ? m[1] : files.find((f) => f.endsWith("/" + m[1]));
    if (p) openFile(p, { line: m[2] ? Number(m[2]) : undefined, endLine: m[3] ? Number(m[3]) : undefined });
  };
  return (
    <div className="md" onClick={onClick}>
      {groups.map((g, i) =>
        Array.isArray(g) ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: linkify(DOMPurify.sanitize(marked.parser(g as any) as string)) }} />
        ) : (
          <CodeBlock key={i} code={(g as any).text} info={(g as any).lang ?? ""} streaming={streaming && i === groups.length - 1} />
        ),
      )}
    </div>
  );
});

function linkify(html: string) {
  // Mark inline code that looks like a workspace file as clickable.
  return html.replace(/<code>([\w./@-]+\.\w+(?::\d+(?:-\d+)?)?)<\/code>/g, '<code class="file-link">$1</code>');
}

function CodeBlock({ code, info, streaming }: { code: string; info: string; streaming?: boolean }) {
  const { lang, path } = parseInfo(info);
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (streaming) { ref.current.textContent = code; return; }
    let cancelled = false;
    monaco.editor.colorize(code, lang || "plaintext", { tabSize: 2 }).then((html) => { if (!cancelled && ref.current) ref.current.innerHTML = html; }).catch(() => {});
    return () => { cancelled = true; };
  }, [code, lang, streaming]);

  const target = path ?? (lang !== "shell" && lang !== "bash" ? activeEditorPath() : undefined);
  const apply = async () => {
    if (!target) return;
    setApplying(true);
    try {
      let original = "";
      try { original = (await api.get(`/api/fs/read?${api.q({ path: target })}`)).content; } catch { /* new file */ }
      const { content } = await api.post("/api/apply", { path: target, original, snippet: code, model: getState().composerModel.startsWith("ensemble/") ? "auto" : getState().composerModel });
      if (original) await ensureModel(target);
      openDiff(target, original, "apply", { modified: content });
    } catch (e: any) { toast(`Apply failed: ${e.message}`, "error"); }
    setApplying(false);
  };
  const runInTerminal = () => {
    window.dispatchEvent(new CustomEvent("spacebar:run-in-terminal", { detail: code }));
  };

  return (
    <div className="codeblock">
      <div className="codeblock-header">
        {path ? <span className="codeblock-file" onClick={() => openFile(path)}><FileIcon name={path.split("/").pop()!} />{path}</span> : <span className="codeblock-lang">{lang || "text"}</span>}
        <span className="spacer" />
        {!streaming && (lang === "shell" || lang === "bash") && <button className="cb-btn" onClick={runInTerminal} title="Run in terminal"><Icon name="play" /> Run</button>}
        <button className="cb-btn" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} title="Copy"><Icon name={copied ? "check" : "copy"} /></button>
        {!streaming && target && lang !== "shell" && (
          <button className="cb-btn apply" onClick={apply} disabled={applying} title={`Apply to ${target}`}>{applying ? <Spinner /> : <Icon name="play" />} Apply</button>
        )}
      </div>
      <pre ref={ref} className="codeblock-body">{code}</pre>
    </div>
  );
}
