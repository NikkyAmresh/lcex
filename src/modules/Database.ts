import * as path from "path";
import * as vscode from "vscode";
import type { Session } from "./interface/Session";

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
  const config = vscode.workspace.getConfiguration("leetcodePractice").get<string>("defaultDirectory") ?? ".";
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
  const config = vscode.workspace.getConfiguration("leetcodePractice");
  const pattern = config.get<string>("fileNamePattern") ?? "id";
  const lang = config.get<string>("language") ?? "typescript";
  const ext = EXT_BY_LANG[lang] ?? ".ts";
  const base = pattern === "slug" ? titleSlug : problemId;
  return base + ext;
}
