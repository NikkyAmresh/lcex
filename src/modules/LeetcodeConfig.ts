import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as Logger from "./Logger";
import { isSupportedLanguage, type SupportedLanguage } from "./interface/Problem";

/** Whether the active slug refers to a study plan or a problem list (disambiguates shared slugs). */
export type ActiveListSource = "studyPlan" | "problemList";

/** Schema for .leetcode config file. Overrides VS Code settings for this workspace. */
export interface LeetcodeConfig {
  studyPlans?: Array<{ slug: string; name: string }>;
  /** LeetCode problem-list slugs (e.g. graph → /problem-list/graph/). */
  problemLists?: Array<{ slug: string; name: string }>;
  /** Default study plan slug for the Study Plans sidebar (must match `studyPlans`). */
  activeStudyPlan?: string;
  /** Default problem-list slug for the Problem Lists sidebar (must match `problemLists`). */
  activeProblemList?: string;
  /** @deprecated Prefer `activeProblemList`. Used only to migrate old configs. */
  activeListSource?: ActiveListSource;
  theme?: "auto" | "leetcode-dark" | "none";
  defaultDirectory?: string;
  fileNamePattern?: "id" | "slug";
  language?: SupportedLanguage;
  internalApiUrl?: string;
  showProblemset?: boolean;
  showStudyPlans?: boolean;
  /** When false, problem lists are omitted from the Study Plans view picker. */
  showProblemLists?: boolean;
  showQotd?: boolean;
  qotdMonths?: number;
  /** Prompt sent to Cursor when clicking "Make runnable" in a solution file. Only in LeetCode workspace. */
  agentPromptMakeRunnable?: string;
  /** Prompt sent to Cursor when clicking "Hint" in a solution file. Only in LeetCode workspace. */
  agentPromptHint?: string;
  /** Base prompt for "Explain my code" (selection appended). Only in LeetCode workspace. */
  agentPromptExplain?: string;
}

const DEFAULTS: Required<
  Omit<LeetcodeConfig, "internalApiUrl" | "activeStudyPlan" | "activeProblemList" | "activeListSource">
> & {
  internalApiUrl: string;
  activeStudyPlan?: string;
  activeProblemList?: string;
  activeListSource?: ActiveListSource;
} = {
  studyPlans: [{ slug: "top-interview-150", name: "Top Interview 150" }],
  problemLists: [] as Array<{ slug: string; name: string }>,
  theme: "auto",
  defaultDirectory: ".",
  fileNamePattern: "id",
  language: "typescript",
  internalApiUrl: "",
  showProblemset: true,
  showStudyPlans: true,
  showProblemLists: true,
  showQotd: true,
  qotdMonths: 6,
  agentPromptMakeRunnable: "Make this Runnable, do not give solution.",
  agentPromptHint:
    "Load **lcex-dsa-hint** and follow it. Hint for my current LeetCode problem—no solution.",
  agentPromptExplain:
    "Explain my solution code for this LeetCode problem. Respond with: (1) Intuition — core idea in plain language; (2) Step-by-step dry run — walk through the algorithm with a small example, including loop/state changes; (3) Time and space complexity with brief justification. Do not rewrite the full solution unless needed for clarity.",
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

function parseProblemLists(raw: unknown): Array<{ slug: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  const result: Array<{ slug: string; name: string }> = [];
  for (const item of raw) {
    if (isValidStudyPlanEntry(item)) {
      result.push({ slug: item.slug, name: item.name });
    }
  }
  return result;
}

/** Infer study plan vs problem list from configured arrays (when slug is not ambiguous). */
export function inferListSourceForSlug(
  slug: string,
  studyPlans: Array<{ slug: string }>,
  problemLists: Array<{ slug: string }>
): ActiveListSource {
  const inStudy = studyPlans.some((p) => p.slug === slug);
  const inProblem = problemLists.some((p) => p.slug === slug);
  if (inStudy && !inProblem) return "studyPlan";
  if (inProblem && !inStudy) return "problemList";
  if (inStudy) return "studyPlan";
  if (inProblem) return "problemList";
  return "studyPlan";
}

/**
 * Fixes stale workspace source (e.g. studyPlan + slug that only exists under problemLists).
 */
export function reconcileListSource(
  slug: string,
  source: ActiveListSource,
  studyPlans: Array<{ slug: string }>,
  problemLists: Array<{ slug: string }>
): ActiveListSource {
  const inStudy = studyPlans.some((p) => p.slug === slug);
  const inProblem = problemLists.some((p) => p.slug === slug);
  if (source === "studyPlan" && !inStudy && inProblem) return "problemList";
  if (source === "problemList" && !inProblem && inStudy) return "studyPlan";
  return source;
}

/** Problem list sidebar has no configured lists — skip API calls. */
export const NO_PROBLEM_LIST_SENTINEL = "__none__";

/** Default study plan slug (Study Plans view only). */
export function resolveDefaultStudyPlanSlug(
  studyPlans: Array<{ slug: string }>,
  activeStudyPlan?: string
): string {
  const t = activeStudyPlan?.trim();
  if (t && studyPlans.some((p) => p.slug === t)) return t;
  return studyPlans[0]?.slug ?? "top-interview-150";
}

/**
 * Default problem-list slug (Problem Lists view only).
 * Migrates legacy `activeStudyPlan` + `activeListSource: problemList` when `activeProblemList` is unset.
 */
export function resolveDefaultProblemListSlug(
  problemLists: Array<{ slug: string }>,
  activeProblemList?: string,
  legacy?: { activeStudyPlan?: string; activeListSource?: ActiveListSource }
): string {
  const t = activeProblemList?.trim();
  if (t && problemLists.some((p) => p.slug === t)) return t;
  if (legacy?.activeListSource === "problemList" && legacy.activeStudyPlan?.trim()) {
    const s = legacy.activeStudyPlan.trim();
    if (problemLists.some((p) => p.slug === s)) return s;
  }
  return problemLists[0]?.slug ?? NO_PROBLEM_LIST_SENTINEL;
}

/**
 * Resolves default slug + source for the Study Plans sidebar when workspace has no saved selection.
 * Uses `activeStudyPlan` + optional `activeListSource`, else first study plan, else first problem list.
 */
export function resolveDefaultStudyOrProblemList(
  studyPlans: Array<{ slug: string; name: string }>,
  problemLists: Array<{ slug: string; name: string }>,
  activeSlug: string | undefined,
  activeSource: ActiveListSource | undefined,
  showProblemLists: boolean
): { slug: string; source: ActiveListSource; displayName?: string } {
  const pl = showProblemLists ? problemLists : [];
  const trimmed = activeSlug?.trim();
  if (trimmed) {
    const source = reconcileListSource(
      trimmed,
      activeSource ?? inferListSourceForSlug(trimmed, studyPlans, problemLists),
      studyPlans,
      problemLists
    );
    const displayName =
      source === "problemList"
        ? problemLists.find((p) => p.slug === trimmed)?.name
        : studyPlans.find((p) => p.slug === trimmed)?.name;
    return { slug: trimmed, source, displayName };
  }
  if (studyPlans[0]) {
    return { slug: studyPlans[0].slug, source: "studyPlan", displayName: studyPlans[0].name };
  }
  if (pl[0]) {
    return { slug: pl[0].slug, source: "problemList", displayName: pl[0].name };
  }
  return { slug: "top-interview-150", source: "studyPlan" };
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
      if (parsed.problemLists !== undefined) {
        merged.problemLists = parseProblemLists(parsed.problemLists);
      }
      if (parsed.activeStudyPlan !== undefined && typeof parsed.activeStudyPlan === "string") {
        merged.activeStudyPlan = parsed.activeStudyPlan;
      }
      if (parsed.activeProblemList !== undefined && typeof parsed.activeProblemList === "string") {
        merged.activeProblemList = parsed.activeProblemList;
      }
      if (parsed.activeListSource === "studyPlan" || parsed.activeListSource === "problemList") {
        merged.activeListSource = parsed.activeListSource;
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
      if (parsed.language !== undefined && isSupportedLanguage(String(parsed.language))) {
        merged.language = parsed.language as SupportedLanguage;
      }
      if (parsed.showProblemset !== undefined && typeof parsed.showProblemset === "boolean") {
        merged.showProblemset = parsed.showProblemset;
      }
      if (parsed.showStudyPlans !== undefined && typeof parsed.showStudyPlans === "boolean") {
        merged.showStudyPlans = parsed.showStudyPlans;
      }
      if (parsed.showProblemLists !== undefined && typeof parsed.showProblemLists === "boolean") {
        merged.showProblemLists = parsed.showProblemLists;
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
      if (parsed.agentPromptExplain !== undefined && typeof parsed.agentPromptExplain === "string") {
        merged.agentPromptExplain = parsed.agentPromptExplain;
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
  const problemLists =
    leetcode.problemLists ?? vscodeConfig.get<Array<{ slug: string; name: string }>>("problemLists") ?? DEFAULTS.problemLists;
  const vsActiveSource = vscodeConfig.get<string>("activeListSource");
  const activeListSourceFromVs =
    vsActiveSource === "studyPlan" || vsActiveSource === "problemList"
      ? (vsActiveSource as ActiveListSource)
      : undefined;
  return {
    studyPlans,
    problemLists,
    activeStudyPlan: leetcode.activeStudyPlan ?? vscodeConfig.get<string>("activeStudyPlan"),
    activeProblemList: leetcode.activeProblemList ?? vscodeConfig.get<string>("activeProblemList"),
    activeListSource: leetcode.activeListSource ?? activeListSourceFromVs,
    theme: leetcode.theme ?? DEFAULTS.theme,
    defaultDirectory: leetcode.defaultDirectory ?? vscodeConfig.get<string>("defaultDirectory") ?? DEFAULTS.defaultDirectory,
    fileNamePattern: (leetcode.fileNamePattern ?? vscodeConfig.get<string>("fileNamePattern") ?? DEFAULTS.fileNamePattern) as "id" | "slug",
    language: (() => {
      const raw = leetcode.language ?? vscodeConfig.get<string>("language") ?? DEFAULTS.language;
      const s = String(raw);
      return isSupportedLanguage(s) ? s : DEFAULTS.language;
    })(),
    internalApiUrl: leetcode.internalApiUrl ?? vscodeConfig.get<string>("internalApiUrl") ?? "",
    showProblemset: leetcode.showProblemset ?? DEFAULTS.showProblemset,
    showStudyPlans: leetcode.showStudyPlans ?? DEFAULTS.showStudyPlans,
    showProblemLists: leetcode.showProblemLists ?? vscodeConfig.get<boolean>("showProblemLists") ?? DEFAULTS.showProblemLists,
    showQotd: leetcode.showQotd ?? DEFAULTS.showQotd,
    qotdMonths: leetcode.qotdMonths ?? DEFAULTS.qotdMonths,
    agentPromptMakeRunnable: leetcode.agentPromptMakeRunnable ?? DEFAULTS.agentPromptMakeRunnable,
    agentPromptHint: leetcode.agentPromptHint ?? DEFAULTS.agentPromptHint,
    agentPromptExplain: leetcode.agentPromptExplain ?? DEFAULTS.agentPromptExplain,
  };
}
