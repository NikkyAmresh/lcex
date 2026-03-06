import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function init(outputChannel: vscode.OutputChannel): void {
  channel = outputChannel;
}

export function log(message: string): void {
  if (channel) {
    const ts = new Date().toISOString();
    channel.appendLine(`[${ts}] ${message}`);
  }
}

export function logError(message: string, err?: unknown): void {
  log(message);
  if (err !== undefined && channel) {
    const detail = err instanceof Error ? err.message : String(err);
    channel.appendLine(`  → ${detail}`);
  }
}
