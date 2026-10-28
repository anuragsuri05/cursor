import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as monaco from "monaco-editor";
import { streamText } from "../lib/api";
import { getState, MOD, toast } from "../lib/store";
import { Icon, Spinner } from "./small";
import { ModelPicker } from "./ModelPicker";

/**
 * Cmd+K inline edit, Cursor-style:
 *  - a prompt box appears above the selection (code is pushed down by a view zone)
 *  - the model streams a rewrite directly into the buffer
 *  - removed lines are shown in red above, new lines highlighted green
 *  - Accept (⌘⏎) / Reject (⌘⌫) / follow-up instructions
 */
export class InlineEditController {
  private zoneId: string | null = null;
  private removedZoneId: string | null = null;
  private widget: monaco.editor.IContentWidget | null = null;
  private root: Root | null = null;
  private dom: HTMLDivElement | null = null;
  private decorations: monaco.editor.IEditorDecorationsCollection;
  private range: monaco.Range | null = null;
  private original = "";
  private abort: AbortController | null = null;
  private state: "input" | "streaming" | "review" = "input";
  private ctxKey: monaco.editor.IContextKey<boolean>;

  constructor(private editor: monaco.editor.IStandaloneCodeEditor) {
    this.decorations = editor.createDecorationsCollection();
    this.ctxKey = editor.createContextKey("spacebarInlineReview", false);
    editor.addAction({ id: "spacebar.inlineEdit", label: "Spacebar: Edit Inline (Cmd+K)", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK], run: () => this.open() });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.accept(), "spacebarInlineReview");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backspace, () => this.reject(), "spacebarInlineReview");
    editor.onDidChangeModel(() => this.close(true));
  }

  open() {
    if (this.state === "review") this.accept();
    this.close(true);
    const model = this.editor.getModel();
    const sel = this.editor.getSelection();
    if (!model || !sel) return;
    // Expand the selection to whole lines (Cursor edits full lines).
    const r = sel.isEmpty()
      ? new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, 1)
      : new monaco.Range(sel.startLineNumber, 1, sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber, model.getLineMaxColumn(sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber));
    this.range = r;
    this.original = sel.isEmpty() ? "" : model.getValueInRange(r);
    if (!sel.isEmpty()) this.decorations.set([{ range: r, options: { isWholeLine: true, className: "inline-selected-line" } }]);
    this.state = "input";
    this.mountWidget(r.startLineNumber);
  }

  private mountWidget(line: number) {
    const dom = document.createElement("div");
    dom.className = "inline-edit-host";
    this.dom = dom;
    dom.style.width = `${Math.min(620, this.editor.getLayoutInfo().contentWidth - 40)}px`;
    this.editor.changeViewZones((acc) => {
      this.zoneId = acc.addZone({ afterLineNumber: line - 1, heightInPx: 96, domNode: document.createElement("div") });
    });
    this.widget = {
      getId: () => "spacebar.inline.widget",
      getDomNode: () => dom,
      getPosition: () => ({ position: { lineNumber: line, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE] }),
      allowEditorOverflow: false,
    };
    this.editor.addContentWidget(this.widget);
    this.root = createRoot(dom);
    this.render();
  }

  private render(extra: { error?: string } = {}) {
    this.root?.render(
      <InlineBox
        state={this.state}
        error={extra.error}
        hasSelection={!!this.original}
        onSubmit={(t, m) => this.run(t, m)}
        onClose={() => (this.state === "review" ? this.reject() : this.close())}
        onAccept={() => this.accept()}
        onReject={() => this.reject()}
        onStop={() => this.abort?.abort()}
        resize={(h) => this.resizeZone(h)}
      />,
    );
  }

  private resizeZone(h: number) {
    if (!this.zoneId) return;
    const line = this.range!.startLineNumber;
    this.editor.changeViewZones((acc) => {
      acc.removeZone(this.zoneId!);
      this.zoneId = acc.addZone({ afterLineNumber: line - 1, heightInPx: h + 10, domNode: document.createElement("div") });
    });
    this.editor.layoutContentWidget(this.widget!);
  }

  private async run(instruction: string, modelId: string) {
    const model = this.editor.getModel();
    if (!model || !this.range || !instruction.trim()) return;
    // A follow-up after a review refines the current text.
    if (this.state === "review") this.clearReviewDecorations();
    const current = model.getValueInRange(this.range);
    const before = model.getValueInRange(new monaco.Range(1, 1, this.range.startLineNumber, this.range.startColumn));
    const after = model.getValueInRange(new monaco.Range(this.range.endLineNumber, this.range.endColumn, model.getLineCount(), model.getLineMaxColumn(model.getLineCount())));
    this.state = "streaming";
    this.render();
    this.abort = new AbortController();
    const start = this.range.getStartPosition();
    let text = "";
    let curRange = this.range;
    const indent = model.getLineContent(start.lineNumber).match(/^\s*/)?.[0] ?? "";
    try {
      await streamText("/api/inline-edit", {
        path: model.uri.path.slice(1), language: model.getLanguageId(), before, selection: current, after, instruction,
        model: modelId,
      }, (d) => {
        text += d;
        const insert = !current && start.column === 1 && text && !text.startsWith(indent) && indent ? text : text;
        model.pushEditOperations([], [{ range: curRange, text: insert }], () => null);
        const lines = insert.split("\n");
        curRange = new monaco.Range(start.lineNumber, start.column, start.lineNumber + lines.length - 1, lines.length > 1 ? lines[lines.length - 1].length + 1 : start.column + insert.length);
        this.decorations.set([{ range: curRange, options: { isWholeLine: true, className: "inline-added-line" } }]);
      }, this.abort.signal);
    } catch (e: any) {
      if (!this.abort.signal.aborted) { toast(e.message, "error"); }
    }
    if (current && !text.endsWith("\n") && current.endsWith("\n")) { /* keep shape */ }
    this.range = curRange;
    this.state = "review";
    this.ctxKey.set(true);
    this.showRemoved(start.lineNumber);
    this.decorations.set([{ range: curRange, options: { isWholeLine: true, className: "inline-added-line", linesDecorationsClassName: "inline-added-gutter" } }]);
    this.render();
    this.editor.focus();
  }

  private showRemoved(line: number) {
    if (!this.original) return;
    const dom = document.createElement("div");
    dom.className = "inline-removed";
    const lang = this.editor.getModel()?.getLanguageId() ?? "plaintext";
    monaco.editor.colorize(this.original, lang, { tabSize: 2 }).then((html) => { dom.innerHTML = html; });
    const h = this.original.split("\n").length * 19;
    this.editor.changeViewZones((acc) => {
      this.removedZoneId = acc.addZone({ afterLineNumber: line - 1, heightInPx: h, domNode: dom });
    });
    // Keep the prompt box above the red "removed" block.
    if (this.dom) this.dom.style.transform = `translateY(-${h}px)`;
  }

  private clearReviewDecorations() {
    if (this.removedZoneId) this.editor.changeViewZones((acc) => acc.removeZone(this.removedZoneId!));
    this.removedZoneId = null;
    this.decorations.clear();
    if (this.dom) this.dom.style.transform = "";
  }

  accept() {
    if (this.state !== "review") return;
    this.close(true);
  }

  reject() {
    const model = this.editor.getModel();
    if (model && this.range && this.state === "review") {
      model.pushEditOperations([], [{ range: this.range, text: this.original }], () => null);
    }
    this.close(true);
  }

  close(silent = false) {
    this.abort?.abort();
    this.clearReviewDecorations();
    if (this.zoneId) this.editor.changeViewZones((acc) => acc.removeZone(this.zoneId!));
    this.zoneId = null;
    if (this.widget) this.editor.removeContentWidget(this.widget);
    this.widget = null;
    const r = this.root;
    this.root = null;
    if (r) setTimeout(() => r.unmount(), 0);
    this.state = "input";
    this.ctxKey.set(false);
    if (!silent) this.editor.focus();
  }
}

function InlineBox(p: {
  state: "input" | "streaming" | "review"; error?: string; hasSelection: boolean;
  onSubmit: (t: string, model: string) => void; onClose: () => void; onAccept: () => void; onReject: () => void; onStop: () => void; resize: (h: number) => void;
}) {
  const [text, setText] = useState("");
  const [model, setModel] = useState(() => getState().composerModel.startsWith("ensemble/") ? "auto" : getState().composerModel);
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setTimeout(() => ta.current?.focus(), 30); }, [p.state]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(() => p.resize(box.current!.offsetHeight));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="inline-box" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="inline-row">
        <textarea
          ref={ta}
          value={text}
          rows={1}
          disabled={p.state === "streaming"}
          placeholder={p.state === "review" ? "Add a follow-up" : p.hasSelection ? "Edit selected code" : "Generate code"}
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text.trim()) { p.onSubmit(text, model); setText(""); } }
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && p.state === "review") { e.preventDefault(); p.onAccept(); }
            else if (e.key === "Backspace" && (e.metaKey || e.ctrlKey) && p.state === "review") { e.preventDefault(); p.onReject(); }
            else if (e.key === "Escape") { e.preventDefault(); p.onClose(); }
          }}
        />
        <button className="icon-btn" title="Close (Esc)" onClick={p.onClose}><Icon name="close" /></button>
      </div>
      <div className="inline-footer">
        <ModelPicker value={model} onChange={setModel} compact allowEnsembles={false} />
        <span className="spacer" />
        {p.state === "streaming" && <><Spinner /><span className="muted">Generating…</span><button className="btn ghost sm" onClick={p.onStop}>Stop</button></>}
        {p.state === "input" && <span className="muted">⏎ to {p.hasSelection ? "edit" : "generate"} · Esc to close</span>}
        {p.state === "review" && (
          <>
            <button className="btn ghost sm" onClick={p.onReject}>Reject <span className="kbd-inline">{MOD}⌫</span></button>
            <button className="btn primary sm" onClick={p.onAccept}>Accept <span className="kbd-inline">{MOD}⏎</span></button>
          </>
        )}
      </div>
    </div>
  );
}
