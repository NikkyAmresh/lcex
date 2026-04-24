import * as vscode from "vscode";

export type InlineSeverity = "muted" | "info" | "success" | "warning" | "error";

export interface InlineItem {
  line: number;
  text: string;
  hoverMarkdown?: string;
  severity?: InlineSeverity;
}

const SEVERITY_COLOR: Record<InlineSeverity, string> = {
  muted: "editorGhostText.foreground",
  info: "editorInfo.foreground",
  success: "charts.green",
  warning: "editorWarning.foreground",
  error: "editorError.foreground",
};

const severityTypes: Partial<Record<InlineSeverity, vscode.TextEditorDecorationType>> = {};

function getType(sev: InlineSeverity): vscode.TextEditorDecorationType {
  let t = severityTypes[sev];
  if (!t) {
    t = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor(SEVERITY_COLOR[sev]),
        fontStyle: "italic",
        margin: "0 0 0 1rem",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    severityTypes[sev] = t;
  }
  return t;
}

type PerSeverity = Map<InlineSeverity, vscode.DecorationOptions[]>;
const state: Map<string, Map<string, PerSeverity>> = new Map();

function reapplyAllSeverities(editor: vscode.TextEditor, byFeature: Map<string, PerSeverity>): void {
  for (const sev of Object.keys(SEVERITY_COLOR) as InlineSeverity[]) {
    const merged: vscode.DecorationOptions[] = [];
    for (const perSev of byFeature.values()) {
      const arr = perSev.get(sev);
      if (arr) merged.push(...arr);
    }
    editor.setDecorations(getType(sev), merged);
  }
}

export function applyInlineDecorations(
  editor: vscode.TextEditor,
  featureId: string,
  items: InlineItem[]
): void {
  const uriKey = editor.document.uri.toString();
  let byFeature = state.get(uriKey);
  if (!byFeature) {
    byFeature = new Map();
    state.set(uriKey, byFeature);
  }

  const bySeverity: PerSeverity = new Map();
  for (const item of items) {
    const sev = item.severity ?? "muted";
    if (item.line < 0 || item.line >= editor.document.lineCount) continue;
    const endCol = editor.document.lineAt(item.line).text.length;
    const range = new vscode.Range(item.line, endCol, item.line, endCol);
    let hover: vscode.MarkdownString | undefined;
    if (item.hoverMarkdown) {
      hover = new vscode.MarkdownString(item.hoverMarkdown);
      hover.isTrusted = true;
      hover.supportHtml = true;
    }
    const opts: vscode.DecorationOptions = {
      range,
      renderOptions: { after: { contentText: item.text } },
      hoverMessage: hover,
    };
    let arr = bySeverity.get(sev);
    if (!arr) {
      arr = [];
      bySeverity.set(sev, arr);
    }
    arr.push(opts);
  }

  byFeature.set(featureId, bySeverity);
  reapplyAllSeverities(editor, byFeature);
}

export function clearInlineDecorations(
  editor: vscode.TextEditor | undefined,
  featureId?: string
): void {
  if (!editor) return;
  const uriKey = editor.document.uri.toString();
  const byFeature = state.get(uriKey);
  if (!byFeature) return;
  if (featureId) byFeature.delete(featureId);
  else byFeature.clear();
  reapplyAllSeverities(editor, byFeature);
  if (byFeature.size === 0) state.delete(uriKey);
}

export function clearAllInlineDecorations(): void {
  for (const ed of vscode.window.visibleTextEditors) {
    const byFeature = state.get(ed.document.uri.toString());
    if (byFeature) {
      byFeature.clear();
      reapplyAllSeverities(ed, byFeature);
    }
  }
  state.clear();
}

export function disposeInlineDecorationTypes(): void {
  for (const key of Object.keys(severityTypes) as InlineSeverity[]) {
    severityTypes[key]?.dispose();
    delete severityTypes[key];
  }
  state.clear();
}
