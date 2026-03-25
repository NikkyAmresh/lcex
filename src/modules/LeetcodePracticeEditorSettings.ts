import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { SupportedLanguage } from "./interface/Problem";

const MARKER = ".leetcode";

/** VS Code / Cursor language ids for `[id]` configuration sections. */
const LANG_SCOPE: Record<SupportedLanguage, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  cpp: "cpp",
};

export function workspaceHasLeetcodeMarker(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return false;
  return folders.some((f) => fs.existsSync(path.join(f.uri.fsPath, MARKER)));
}

/**
 * Workspace-level overrides for the given language only: fewer Tab-driven completions
 * (inline ghost text + snippet/word tab completion) while practicing in a `.leetcode` folder.
 */
export async function suppressTabLikeFeaturesForPracticeLanguage(
  language: SupportedLanguage
): Promise<void> {
  if (!workspaceHasLeetcodeMarker()) return;
  const scope = LANG_SCOPE[language];
  const cfg = vscode.workspace.getConfiguration(`[${scope}]`, null);
  const target = vscode.ConfigurationTarget.Workspace;
  await cfg.update("editor.inlineSuggest.enabled", false, target);
  await cfg.update("editor.tabCompletion", "off", target);
}

/**
 * Workspace-wide: disable inline suggestions everywhere in this workspace (stronger than per-language).
 */
export async function suppressInlineSuggestWorkspaceWide(): Promise<void> {
  if (!workspaceHasLeetcodeMarker()) return;
  await vscode.workspace
    .getConfiguration("editor", null)
    .update("inlineSuggest.enabled", false, vscode.ConfigurationTarget.Workspace);
}
