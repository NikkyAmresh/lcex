import * as path from "path";
import * as vscode from "vscode";
import type { Session } from "./interface/Session";
import { getEffectiveConfig } from "./LeetcodeConfig";

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

const EXT_BY_LANG: Record<string, string> = {
  typescript: ".ts",
  javascript: ".js",
  python: ".py",
};

export function getFileName(problemId: string, titleSlug: string): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders);
  const pattern = config.fileNamePattern ?? "id";
  const lang = config.language ?? "typescript";
  const ext = EXT_BY_LANG[lang] ?? ".ts";
  const base = pattern === "slug" ? titleSlug : problemId;
  return base + ext;
}

/** Absolute paths for id- vs slug-based solution filenames (same extension from workspace language). */
export function getSolutionPathSet(
  baseUri: vscode.Uri | undefined,
  problemId: string,
  titleSlug: string
): { idPath: string; slugPath: string; preferredNewPath: string } {
  const targetDir = getTargetDir(baseUri);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders);
  const ext = EXT_BY_LANG[config.language ?? "typescript"] ?? ".ts";
  const pattern = config.fileNamePattern ?? "id";
  const idPath = path.join(targetDir, problemId + ext);
  const slugPath = path.join(targetDir, titleSlug + ext);
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
  titleSlug: string
): Promise<{ path: string; exists: boolean }> {
  const { idPath, slugPath, preferredNewPath } = getSolutionPathSet(
    baseUri,
    problemId,
    titleSlug
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
