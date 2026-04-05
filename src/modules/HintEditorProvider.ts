import * as vscode from "vscode";
import { emptyHintContentPreserveMeta, normalizeHintData, parseHintFileJson, serializeHintFile } from "./HintFile";
import { renderHintViewHtml } from "./HintAnalysisHtml";

function escapeHtmlPlain(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fullDocumentRange(doc: vscode.TextDocument): vscode.Range {
  const last = doc.lineAt(doc.lineCount - 1);
  return new vscode.Range(new vscode.Position(0, 0), last.range.end);
}

async function replaceDocumentText(document: vscode.TextDocument, newText: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullDocumentRange(document), newText);
  return vscode.workspace.applyEdit(edit);
}

export class HintEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "leetcode-practice.hintEditor";

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const iconUri = vscode.Uri.joinPath(this._context.extensionUri, "icons", "hint.svg");
    webviewPanel.iconPath = { light: iconUri, dark: iconUri };
    webviewPanel.webview.options = { enableScripts: true, localResourceRoots: [] };

    const updateWebview = (): void => {
      const text = document.getText();
      const parsed = parseHintFileJson(text);
      if (!parsed.ok) {
        webviewPanel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family,sans-serif);padding:20px;color:#ef4444;background:#1e1e1e;font-size:13px;">
<p style="color:#9d8df1;font-weight:600;margin:0 0 8px;">Invalid JSON</p>
<p style="color:#f9fafb;">${escapeHtmlPlain(parsed.error)}</p>
<p style="color:#9ca3af;margin-top:12px;">Use <strong>Reopen Editor With…</strong> → <strong>Text Editor</strong> to fix the file.</p>
</body></html>`;
        return;
      }
      const data = normalizeHintData(parsed.data);
      const problemLine =
        data.problemTitle && data.titleSlug
          ? `${data.problemTitle} · ${data.titleSlug}`
          : data.problemTitle || data.titleSlug || "Hint";
      webviewPanel.webview.html = renderHintViewHtml(webviewPanel.webview, problemLine, data);
    };

    updateWebview();

    const subDoc = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      const text = document.getText();
      const parsed = parseHintFileJson(text);
      if (!parsed.ok) {
        return;
      }
      const base = normalizeHintData(parsed.data);

      if (msg.type === "reanalyze") {
        await replaceDocumentText(document, serializeHintFile(emptyHintContentPreserveMeta(base)));
        await vscode.commands.executeCommand("leetcode-practice.agentHint", {
          titleSlug: base.titleSlug,
          forceAgent: true,
        });
      }
    });

    webviewPanel.onDidDispose(() => subDoc.dispose());
  }
}
