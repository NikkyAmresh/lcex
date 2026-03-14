import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as Logger from "./Logger";

/** Schema for .leetcode config file. Overrides VS Code settings for this workspace. */
export interface LeetcodeConfig {
  studyPlans?: Array<{ slug: string; name: string }>;
  activeStudyPlan?: string;
  theme?: "auto" | "leetcode-dark" | "none";
  defaultDirectory?: string;
  fileNamePattern?: "id" | "slug";
  language?: "typescript" | "javascript" | "python";
  internalApiUrl?: string;
  showProblemset?: boolean;
  showStudyPlans?: boolean;
  showQotd?: boolean;
  qotdMonths?: number;
  /** Prompt sent to Cursor when clicking "Make runnable" in a solution file. Only in LeetCode workspace. */
  agentPromptMakeRunnable?: string;
  /** Prompt sent to Cursor when clicking "Hint" in a solution file. Only in LeetCode workspace. */
  agentPromptHint?: string;
}

const DEFAULTS: Required<Omit<LeetcodeConfig, "internalApiUrl" | "activeStudyPlan">> & { internalApiUrl: string; activeStudyPlan?: string } = {
  studyPlans: [{ slug: "top-interview-150", name: "Top Interview 150" }],
  theme: "auto",
  defaultDirectory: ".",
  fileNamePattern: "id",
  language: "typescript",
  internalApiUrl: "",
  showProblemset: true,
  showStudyPlans: true,
  showQotd: true,
  qotdMonths: 6,
  agentPromptMakeRunnable: "Make this Runnable, do not give solution.",
  agentPromptHint: "Give me a hint for this problem. Do not give the solution.",
};

function isValidStudyPlanEntry(obj: unknown): obj is { slug: string; name: string } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as { slug?: unknown }).slug === "string" &&
    typeof (obj as { name?: unknown }).name === "string"
  );
}

function parseStudyPlans(raw: unknown): Array<{ slug: string; name: string }> {
  if (!Array.isArray(raw)) return DEFAULTS.studyPlans;
  const result: Array<{ slug: string; name: string }> = [];
  for (const item of raw) {
    if (isValidStudyPlanEntry(item)) {
      result.push({ slug: item.slug, name: item.name });
    }
  }
  return result.length > 0 ? result : DEFAULTS.studyPlans;
}

function findLeetcodeFiles(workspaceFolders: readonly vscode.WorkspaceFolder[]): string[] {
  const found: string[] = [];
  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const rootFile = path.join(rootPath, ".leetcode");
    if (fs.existsSync(rootFile)) {
      found.push(rootFile);
      continue;
    }
    const maxDepth = 4;
    function search(dir: string, depth: number): void {
      if (depth > maxDepth) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === ".leetcode" && e.isFile()) {
            found.push(path.join(dir, e.name));
            return;
          }
          if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
            search(path.join(dir, e.name), depth + 1);
            if (found.length > 0) return;
          }
        }
      } catch {
        /* ignore */
      }
    }
    search(rootPath, 0);
  }
  return found;
}

/**
 * Parses .leetcode file from workspace. Searches folder roots first, then subfolders.
 * Empty file or invalid JSON falls back to defaults.
 */
function readLeetcodeFileContent(configPath: string): string {
  const normalizedConfig = path.resolve(configPath);
  const doc = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.uri.fsPath) === normalizedConfig
  );
  if (doc) {
    const text = doc.getText().trim();
    if (text) return text;
  }
  return fs.readFileSync(configPath, "utf-8").trim();
}

export function parseLeetcodeConfig(workspaceFolders: readonly vscode.WorkspaceFolder[]): LeetcodeConfig {
  const merged: LeetcodeConfig = { ...DEFAULTS };
  const configPaths = findLeetcodeFiles(workspaceFolders);
  for (const configPath of configPaths) {
    try {
      const raw = readLeetcodeFileContent(configPath);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.studyPlans !== undefined) {
        merged.studyPlans = parseStudyPlans(parsed.studyPlans);
      }
      if (parsed.activeStudyPlan !== undefined && typeof parsed.activeStudyPlan === "string") {
        merged.activeStudyPlan = parsed.activeStudyPlan;
      }
      if (parsed.theme !== undefined && ["auto", "leetcode-dark", "none"].includes(String(parsed.theme))) {
        merged.theme = parsed.theme as LeetcodeConfig["theme"];
      }
      if (parsed.defaultDirectory !== undefined && typeof parsed.defaultDirectory === "string") {
        merged.defaultDirectory = parsed.defaultDirectory;
      }
      if (parsed.fileNamePattern !== undefined && ["id", "slug"].includes(String(parsed.fileNamePattern))) {
        merged.fileNamePattern = parsed.fileNamePattern as "id" | "slug";
      }
      if (parsed.language !== undefined && ["typescript", "javascript", "python"].includes(String(parsed.language))) {
        merged.language = parsed.language as "typescript" | "javascript" | "python";
      }
      if (parsed.showProblemset !== undefined && typeof parsed.showProblemset === "boolean") {
        merged.showProblemset = parsed.showProblemset;
      }
      if (parsed.showStudyPlans !== undefined && typeof parsed.showStudyPlans === "boolean") {
        merged.showStudyPlans = parsed.showStudyPlans;
      }
      if (parsed.showQotd !== undefined && typeof parsed.showQotd === "boolean") {
        merged.showQotd = parsed.showQotd;
      }
      if (parsed.qotdMonths !== undefined && typeof parsed.qotdMonths === "number" && parsed.qotdMonths >= 1) {
        merged.qotdMonths = parsed.qotdMonths;
      }
      if (parsed.internalApiUrl !== undefined && typeof parsed.internalApiUrl === "string") {
        merged.internalApiUrl = parsed.internalApiUrl;
      }
      if (parsed.agentPromptMakeRunnable !== undefined && typeof parsed.agentPromptMakeRunnable === "string") {
        merged.agentPromptMakeRunnable = parsed.agentPromptMakeRunnable;
      }
      if (parsed.agentPromptHint !== undefined && typeof parsed.agentPromptHint === "string") {
        merged.agentPromptHint = parsed.agentPromptHint;
      }
    } catch (e) {
      Logger.log(`LeetcodeConfig: failed to parse ${configPath}, using defaults: ${e}`);
    }
  }
  return merged;
}

/** Merged config: .leetcode overrides VS Code leetcodePractice.* settings. */
export function getEffectiveConfig(workspaceFolders: readonly vscode.WorkspaceFolder[]): LeetcodeConfig & { internalApiUrl: string } {
  const vscodeConfig = vscode.workspace.getConfiguration("leetcodePractice");
  const leetcode = parseLeetcodeConfig(workspaceFolders);
  const studyPlans = leetcode.studyPlans ?? vscodeConfig.get<Array<{ slug: string; name: string }>>("studyPlans") ?? DEFAULTS.studyPlans;
  return {
    studyPlans,
    activeStudyPlan: leetcode.activeStudyPlan ?? vscodeConfig.get<string>("activeStudyPlan"),
    theme: leetcode.theme ?? DEFAULTS.theme,
    defaultDirectory: leetcode.defaultDirectory ?? vscodeConfig.get<string>("defaultDirectory") ?? DEFAULTS.defaultDirectory,
    fileNamePattern: (leetcode.fileNamePattern ?? vscodeConfig.get<string>("fileNamePattern") ?? DEFAULTS.fileNamePattern) as "id" | "slug",
    language: (leetcode.language ?? vscodeConfig.get<string>("language") ?? DEFAULTS.language) as "typescript" | "javascript" | "python",
    internalApiUrl: leetcode.internalApiUrl ?? vscodeConfig.get<string>("internalApiUrl") ?? "",
    showProblemset: leetcode.showProblemset ?? DEFAULTS.showProblemset,
    showStudyPlans: leetcode.showStudyPlans ?? DEFAULTS.showStudyPlans,
    showQotd: leetcode.showQotd ?? DEFAULTS.showQotd,
    qotdMonths: leetcode.qotdMonths ?? DEFAULTS.qotdMonths,
    agentPromptMakeRunnable: leetcode.agentPromptMakeRunnable ?? DEFAULTS.agentPromptMakeRunnable,
    agentPromptHint: leetcode.agentPromptHint ?? DEFAULTS.agentPromptHint,
  };
}
