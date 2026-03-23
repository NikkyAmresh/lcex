import * as vscode from "vscode";
import type { IProblemProvider } from "./interface/Problem";
import { readInterviewReportFile } from "./LcexInterviewReportStore";
import {
  interviewReportViewModelFromSnapshotFile,
  openInterviewAttemptSolutionFile,
  renderInterviewReportHtml,
} from "./ProblemView";

export class LcInterviewReportEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getProvider: () => IProblemProvider
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const iconUri = vscode.Uri.joinPath(this.context.extensionUri, "icons", "logo-dark-16.png");
    webviewPanel.iconPath = { light: iconUri, dark: iconUri };
    webviewPanel.webview.options = { enableScripts: true, localResourceRoots: [] };

    const update = async () => {
      const file = readInterviewReportFile(document.uri.fsPath);
      if (!file) {
        webviewPanel.webview.html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;color:#ccc;background:#1e1e1e;">Invalid or unreadable report file.</body></html>`;
        return;
      }
      const model = interviewReportViewModelFromSnapshotFile(file);
      webviewPanel.webview.html = await renderInterviewReportHtml(this.context, model);
    };

    void update();

    webviewPanel.webview.onDidReceiveMessage((msg: { type?: string; titleSlug?: string }) => {
      if (msg?.type !== "openAttemptSolution" || typeof msg.titleSlug !== "string") return;
      const file = readInterviewReportFile(document.uri.fsPath);
      if (!file) return;
      const model = interviewReportViewModelFromSnapshotFile(file);
      void openInterviewAttemptSolutionFile(this.context, this.getProvider, model, msg.titleSlug);
    });

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void update();
      }
    });
    webviewPanel.onDidDispose(() => sub.dispose());
  }
}
