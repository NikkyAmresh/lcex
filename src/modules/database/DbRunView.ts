/**
 * Results panel for a local database run: verdict, your grid beside the expected
 * grid, and the tables as they were seeded.
 *
 * One panel is reused per problem so repeated runs replace the previous result
 * instead of stacking tabs. The view model itself is built in `DbRunner` so it
 * stays testable without vscode.
 */
import * as path from "path";
import * as ejs from "ejs";
import * as vscode from "vscode";
import type { Problem } from "../interface/Problem";
import { buildDbRunViewModel, type DbRunOutcome } from "./DbRunner";

const VIEW_TYPE = "lcexDbRun";

const panels = new Map<string, vscode.WebviewPanel>();

export async function renderDbRunHtml(
  context: vscode.ExtensionContext,
  problem: Problem,
  outcome: DbRunOutcome
): Promise<string> {
  const templatePath = path.join(context.extensionPath, "out", "templates", "db-run.ejs");
  return ejs.renderFile(templatePath, { ...buildDbRunViewModel(problem, outcome) });
}

/**
 * Opens or updates the results panel for this problem. With
 * `createIfMissing: false` an already-open panel is refreshed but no new one is
 * opened, which is what on-save runs want.
 */
export async function showDbRunResult(
  context: vscode.ExtensionContext,
  problem: Problem,
  outcome: DbRunOutcome,
  opts?: { createIfMissing?: boolean }
): Promise<void> {
  const existing = panels.get(problem.titleSlug);
  if (!existing && opts?.createIfMissing === false) return;
  const html = await renderDbRunHtml(context, problem, outcome);
  if (existing) {
    existing.webview.html = html;
    if (opts?.createIfMissing !== false) {
      existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Three, true);
    }
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `Query result: ${problem.id}`,
    { viewColumn: vscode.ViewColumn.Three, preserveFocus: true },
    { retainContextWhenHidden: true }
  );
  panel.webview.html = html;
  panels.set(problem.titleSlug, panel);
  panel.onDidDispose(() => {
    if (panels.get(problem.titleSlug) === panel) panels.delete(problem.titleSlug);
  });
}
