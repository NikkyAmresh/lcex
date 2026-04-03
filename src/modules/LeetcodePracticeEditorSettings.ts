import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { SupportedLanguage } from "./interface/Problem";
import * as Logger from "./Logger";

const MARKER = ".leetcode";

/** Applied to the workspace when a `.leetcode` marker exists (matches LCEX practice styling). */
export const LCEX_EDITOR_FONT_FAMILY = "Fira Code iScript";

export const LCEX_EDITOR_TOKEN_COLOR_CUSTOMIZATIONS = {
  textMateRules: [
    {
      scope: [
        "comment",
        "keyword",
        "storage.modifier",
        "storage.type",
        "storage.type.class.js",
        "storage.type.js",
        "storage.type.ts",
        "storage.type.class.ts",
      ],
      settings: {
        fontStyle: "italic",
      },
    },
    {
      scope: ["keyword.operator"],
      settings: {
        fontStyle: "",
      },
    },
  ],
} as const;

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

function workspaceJsonEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Sets Fira Code iScript and italic token rules for LeetCode practice workspaces (folder with `.leetcode`).
 * Only writes workspace-level settings when they differ from the LCEX defaults.
 */
export async function applyLcexEditorFontAndTokenSettingsIfNeeded(): Promise<void> {
  if (!workspaceHasLeetcodeMarker()) return;
  const editorCfg = vscode.workspace.getConfiguration("editor", null);
  const target = vscode.ConfigurationTarget.Workspace;

  const fontInspect = editorCfg.inspect<string>("fontFamily");
  const workspaceFont = fontInspect?.workspaceValue ?? fontInspect?.workspaceFolderValue;
  const tokenInspect = editorCfg.inspect<Record<string, unknown>>("tokenColorCustomizations");
  const workspaceToken = tokenInspect?.workspaceValue ?? tokenInspect?.workspaceFolderValue;

  const desiredToken = JSON.parse(JSON.stringify(LCEX_EDITOR_TOKEN_COLOR_CUSTOMIZATIONS)) as Record<
    string,
    unknown
  >;
  const needsFont = workspaceFont !== LCEX_EDITOR_FONT_FAMILY;
  const needsToken = !workspaceJsonEqual(workspaceToken, desiredToken);

  if (!needsFont && !needsToken) return;

  try {
    if (needsFont) {
      await editorCfg.update("fontFamily", LCEX_EDITOR_FONT_FAMILY, target);
    }
    if (needsToken) {
      await editorCfg.update("tokenColorCustomizations", desiredToken, target);
    }
  } catch (e) {
    Logger.logError("LCEX editor font/token settings: failed to update workspace settings", e);
  }
}
