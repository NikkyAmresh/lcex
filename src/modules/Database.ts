import * as path from "path";
import * as vscode from "vscode";
import type { Session } from "./interface/Session";
import { getEffectiveConfig } from "./LeetcodeConfig";
import type { SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

const SESSION_KEY = "leetcodeSession";

export function getSession(context: vscode.ExtensionContext): Session | undefined {
  return context.globalState.get(SESSION_KEY);
}

export function isLoggedIn(context: vscode.ExtensionContext): boolean {
  const s = getSession(context);
  return Boolean(s?.cookie?.trim());
}

export async function saveSession(context: vscode.ExtensionContext, cookie: string): Promise<void> {
  await context.globalState.update(SESSION_KEY, { cookie: cookie.trim() });
}

export async function clearSession(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SESSION_KEY, undefined);
}

export function getTargetDir(uri: vscode.Uri | undefined): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders).defaultDirectory ?? ".";
  const workspaceRoot = folders[0]?.uri.fsPath;
  const base = uri ? path.dirname(uri.fsPath) : workspaceRoot ?? process.cwd();
  if (config === "." || !config) return base;
  if (path.isAbsolute(config)) return config;
  return path.resolve(workspaceRoot ?? base, config);
}

export function getFileName(problemId: string, titleSlug: string): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders);
  const pattern = config.fileNamePattern ?? "id";
  const lang = config.language ?? "typescript";
  const ext = getLanguageStrategy(lang).fileExtension;
  const base = pattern === "slug" ? titleSlug : problemId;
  return base + ext;
}

const ATTEMPT_HEX = /^[0-9a-f]{3}$/i;

/** Absolute paths for id- vs slug-based solution filenames (same extension from workspace language). */
export function getSolutionPathSet(
  baseUri: vscode.Uri | undefined,
  problemId: string,
  titleSlug: string,
  solutionBaseDir?: string,
  attemptHex?: string,
  language?: SupportedLanguage
): { idPath: string; slugPath: string; preferredNewPath: string } {
  const targetDir =
    typeof solutionBaseDir === "string" && solutionBaseDir.trim()
      ? path.resolve(solutionBaseDir.trim())
      : getTargetDir(baseUri);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders);
  const lang = language ?? config.language ?? "typescript";
  const ext = getLanguageStrategy(lang).fileExtension;
  const pattern = config.fileNamePattern ?? "id";
  const suffix =
    typeof attemptHex === "string" && ATTEMPT_HEX.test(attemptHex.trim())
      ? `-${attemptHex.trim().toLowerCase()}`
      : "";
  const idPath = path.join(targetDir, `${problemId}${suffix}${ext}`);
  const slugPath = path.join(targetDir, `${titleSlug}${suffix}${ext}`);
  const preferredNewPath = pattern === "slug" ? slugPath : idPath;
  return { idPath, slugPath, preferredNewPath };
}

/**
 * Picks the solution file path: if both id- and slug-named files exist, uses `fileNamePattern`;
 * otherwise the file that exists; if neither exists, returns `preferredNewPath` for creation.
 */
export async function resolveSolutionFilePathForOpen(
  baseUri: vscode.Uri | undefined,
  problemId: string,
  titleSlug: string,
  solutionBaseDir?: string,
  attemptHex?: string,
  language?: SupportedLanguage
): Promise<{ path: string; exists: boolean }> {
  const { idPath, slugPath, preferredNewPath } = getSolutionPathSet(
    baseUri,
    problemId,
    titleSlug,
    solutionBaseDir,
    attemptHex,
    language
  );
  const folders = vscode.workspace.workspaceFolders ?? [];
  const pattern = getEffectiveConfig(folders).fileNamePattern ?? "id";
  let idExists = false;
  let slugExists = false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(idPath));
    idExists = true;
  } catch {
    /* missing */
  }
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(slugPath));
    slugExists = true;
  } catch {
    /* missing */
  }
  if (idExists && slugExists) {
    return { path: pattern === "slug" ? slugPath : idPath, exists: true };
  }
  if (idExists) return { path: idPath, exists: true };
  if (slugExists) return { path: slugPath, exists: true };
  return { path: preferredNewPath, exists: false };
}
