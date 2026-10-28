import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { getState } from "./store";

(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

// The workspace isn't a TS project Monaco can resolve, so silence "cannot find module" noise.
const ts = (monaco.languages as any).typescript;
if (ts) {
  for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    d.setCompilerOptions({ jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, allowJs: true, allowNonTsExtensions: true, moduleResolution: ts.ModuleResolutionKind.NodeJs });
  }
}

// Cursor-style dark theme.
monaco.editor.defineTheme("spacebar-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "D6D6DD" },
    { token: "comment", foreground: "6D6D6D", fontStyle: "italic" },
    { token: "keyword", foreground: "82D2CE" },
    { token: "keyword.control", foreground: "83D6C5" },
    { token: "storage", foreground: "82D2CE" },
    { token: "string", foreground: "E394DC" },
    { token: "string.escape", foreground: "D6D6DD" },
    { token: "number", foreground: "EBC88D" },
    { token: "regexp", foreground: "D6D6DD" },
    { token: "type", foreground: "87C3FF" },
    { token: "type.identifier", foreground: "87C3FF" },
    { token: "identifier", foreground: "D6D6DD" },
    { token: "function", foreground: "EFB080" },
    { token: "variable", foreground: "D6D6DD" },
    { token: "variable.predefined", foreground: "AA9BF5" },
    { token: "constant", foreground: "AA9BF5" },
    { token: "tag", foreground: "87C3FF" },
    { token: "attribute.name", foreground: "AAA0FA" },
    { token: "attribute.value", foreground: "E394DC" },
    { token: "delimiter", foreground: "D6D6DD" },
    { token: "delimiter.html", foreground: "898989" },
    { token: "key", foreground: "87C3FF" },
    { token: "string.key.json", foreground: "87C3FF" },
    { token: "string.value.json", foreground: "E394DC" },
    { token: "metatag", foreground: "82D2CE" },
  ],
  colors: {
    "editor.background": "#181818",
    "editor.foreground": "#D6D6DD",
    "editorLineNumber.foreground": "#535353",
    "editorLineNumber.activeForeground": "#C2C2C2",
    "editor.lineHighlightBackground": "#1F1F1F",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#40404099",
    "editor.inactiveSelectionBackground": "#3A3A3A66",
    "editor.selectionHighlightBackground": "#3A3A3A88",
    "editorCursor.foreground": "#D6D6DD",
    "editorWhitespace.foreground": "#3A3A3A",
    "editorIndentGuide.background1": "#262626",
    "editorIndentGuide.activeBackground1": "#3E3E3E",
    "editorGutter.background": "#181818",
    "editorWidget.background": "#1E1E1E",
    "editorWidget.border": "#2E2E2E",
    "editorSuggestWidget.background": "#1E1E1E",
    "editorSuggestWidget.border": "#2E2E2E",
    "editorSuggestWidget.selectedBackground": "#2C2C2C",
    "editorHoverWidget.background": "#1E1E1E",
    "editorHoverWidget.border": "#2E2E2E",
    "editorGhostText.foreground": "#7A7A7A",
    "editorBracketMatch.background": "#3A3A3A55",
    "editorBracketMatch.border": "#55555500",
    "scrollbarSlider.background": "#4A4A4A44",
    "scrollbarSlider.hoverBackground": "#5A5A5A66",
    "scrollbarSlider.activeBackground": "#6A6A6A88",
    "editorOverviewRuler.border": "#00000000",
    "diffEditor.insertedTextBackground": "#3FB95026",
    "diffEditor.removedTextBackground": "#F8514926",
    "diffEditor.insertedLineBackground": "#3FB9501A",
    "diffEditor.removedLineBackground": "#F851491A",
    "minimap.background": "#181818",
    "input.background": "#222222",
    "focusBorder": "#3A3A3A",
  },
});

// ---------------------------------------------------------------------------
// Tab: AI inline completions (ghost text), powered by the fastest free model.

let lastReq: AbortController | null = null;

monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, {
  async provideInlineCompletions(model, position, _ctx, token) {
    const s = getState();
    if (!s.settings?.tabEnabled || model.uri.scheme !== "file") return { items: [] };
    // Debounce: wait for a pause in typing.
    await new Promise((r) => setTimeout(r, 280));
    if (token.isCancellationRequested) return { items: [] };
    lastReq?.abort();
    const ac = new AbortController();
    lastReq = ac;
    token.onCancellationRequested(() => ac.abort());
    const full = model.getValue();
    const offset = model.getOffsetAt(position);
    const prefix = full.slice(0, offset);
    const suffix = full.slice(offset);
    // Skip when the cursor is in the middle of a word.
    const after = model.getLineContent(position.lineNumber).slice(position.column - 1);
    if (/^\w/.test(after)) return { items: [] };
    try {
      const res = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: model.uri.path.slice(1), language: model.getLanguageId(), prefix, suffix }),
        signal: ac.signal,
      });
      const { text } = await res.json();
      if (!text || token.isCancellationRequested) return { items: [] };
      return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
    } catch {
      return { items: [] };
    }
  },
  freeInlineCompletions() {},
  disposeInlineCompletions() {},
} as any);

export { monaco };
