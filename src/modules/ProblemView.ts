import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import * as ejs from "ejs";
import {
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type IProblemProvider,
  type Problem,
  type SupportedLanguage,
} from "./interface/Problem";
import {
  LANGUAGE_CHOICES,
  LANGUAGE_SHORT,
  getLanguageStrategy,
  languageStrategyFromExtension,
  leetcodeApiLangFor,
  SOLUTION_FILE_EXTENSIONS,
} from "./language/LanguageStrategy";
import type { ProblemListItem } from "./LeetCode";
import type { ProblemStatus } from "./ProblemsProvider";
import {
  getAllStatusEntries,
  getStoredStatus,
  setProblemStatus,
  type StoredStatusEntry,
} from "./ProblemsProvider";
import * as Database from "./Database";
import { getEffectiveConfig } from "./LeetcodeConfig";
import { LeetCodeProvider } from "./LeetCode";
import { generateTemplate } from "./TemplateEngine";
import { pollRunStatus, pollSubmitStatus } from "../utils/apiPoller";
import * as Logger from "./Logger";
import {
  bucketDifficulty,
  bucketLanguage,
  track as trackAnalytics,
} from "./cloud/analytics";
import { createDefaultHintFileJson } from "./HintFile";
import { lookupProblem as lookupCompaniesProblem } from "./CompaniesData";
import { getProblemTimer, TIMER_BY_DAY_KEY, TIMER_ELAPSED_KEY, type TimerByDay } from "./ProblemTimer";
import {
  FOCUS_COMPACT_WEBVIEW_KEY,
  FOCUS_ZEN_STATUSBAR_PREV_KEY,
  LAST_CHALLENGE_PANEL_LANGUAGE_KEY,
  countSolvedToday,
  dailyGoalProgressPercent,
  getDailyGoal,
  getTotalXp,
  sumTimerMinutesToday,
  todayIso,
  xpLevelProgress,
} from "./Gamification";
import {
  getInterviewHistory,
  getInterviewSession,
  setInterviewFocusProblem,
  type InterviewHistoryEntry,
  type InterviewSessionState,
} from "./InterviewMode";
import type { LcInterviewReportFileV1 } from "./LcexInterviewReportStore";
import {
  suppressInlineSuggestWorkspaceWide,
  suppressTabLikeFeaturesForPracticeLanguage,
  workspaceHasLeetcodeMarker,
} from "./LeetcodePracticeEditorSettings";

export interface ProblemViewState {
  webviewPanel: vscode.WebviewPanel;
  problem: Problem;
  testcasesPanel?: vscode.WebviewPanel;
}

const problemViews = new Map<string, ProblemViewState>();

const PROBLEM_PLAIN_DOC_SCHEME = "leetcode-problem-plain";

let plainProblemDocEmitter: vscode.EventEmitter<vscode.Uri> | undefined;

function slugFromPlainProblemUri(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, "").replace(/\.txt$/i, "");
}

function problemHtmlToPlainText(html: string): string {
  let s = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatProblemPlainText(problem: Problem): string {
  const lines: string[] = [
    problem.title,
    `LeetCode #${problem.id} · ${problem.difficulty || "Unknown"}`,
    "",
    problemHtmlToPlainText(problem.content || "") || "(No description.)",
  ];
  if (problem.sampleTestCase?.trim()) {
    lines.push("", "Sample test case (stdin):", problem.sampleTestCase.trim());
  }
  if (problem.exampleTestCases?.length) {
    for (const ex of problem.exampleTestCases) {
      if (ex?.trim()) {
        lines.push("", "Example:", ex.trim());
      }
    }
  }
  const snippet = problem.codeSnippet?.trim();
  if (snippet) {
    lines.push("", "Default code snippet:", snippet);
  }
  return lines.join("\n");
}

function firePlainProblemDocumentChanged(titleSlug: string): void {
  if (!plainProblemDocEmitter) return;
  plainProblemDocEmitter.fire(
    vscode.Uri.from({ scheme: PROBLEM_PLAIN_DOC_SCHEME, path: `/${titleSlug}.txt` })
  );
}

export function registerProblemPlainTextDocumentProvider(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider
): vscode.Disposable {
  plainProblemDocEmitter = new vscode.EventEmitter<vscode.Uri>();
  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: plainProblemDocEmitter.event,
    provideTextDocumentContent: async (uri: vscode.Uri): Promise<string> => {
      const slug = slugFromPlainProblemUri(uri);
      if (!slug) return "";
      await ensureProblemCacheLoaded(context);
      let problem = getCachedProblem(slug);
      if (!problem) {
        const fetched = await getProvider().getProblem(slug);
        if (!fetched) return "Could not load problem.";
        setCachedProblem(slug, fetched, context);
        problem = fetched;
      }
      return formatProblemPlainText(problem);
    },
  };
  const registration = vscode.workspace.registerTextDocumentContentProvider(
    PROBLEM_PLAIN_DOC_SCHEME,
    provider
  );
  return new vscode.Disposable(() => {
    registration.dispose();
    plainProblemDocEmitter?.dispose();
    plainProblemDocEmitter = undefined;
  });
}

async function openProblemAsPlainText(
  context: vscode.ExtensionContext,
  item: ProblemListItem,
  getProvider: () => IProblemProvider,
  column: vscode.ViewColumn
): Promise<void> {
  await ensureProblemCacheLoaded(context);
  let problem = getCachedProblem(item.titleSlug);
  if (!problem) {
    const fetched = await getProvider().getProblem(item.titleSlug);
    if (!fetched) {
      vscode.window.showErrorMessage("Could not load problem.");
      return;
    }
    setCachedProblem(item.titleSlug, fetched, context);
    problem = fetched;
  }
  const uri = vscode.Uri.from({
    scheme: PROBLEM_PLAIN_DOC_SCHEME,
    path: `/${item.titleSlug}.txt`,
  });
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });
}

/** Single stats webview (reused + refresh command target). */
let statsWebviewPanel: vscode.WebviewPanel | null = null;

export type InterviewSetupStartMessage = {
  type: "start";
  durationMinutes: 45 | 60 | 180;
  problemCount: number;
  customSlugsRaw: string;
};

export type InterviewSetupOpenProblemMessage = {
  type: "openProblem";
  titleSlug: string;
};

export type InterviewSetupHandlers = {
  onStart: (msg: InterviewSetupStartMessage) => Promise<{ ok: true } | { ok: false; message: string }>;
  onOpenProblem: (titleSlug: string) => Promise<void>;
};

export interface InterviewHubRow {
  titleSlug: string;
  title: string;
  difficulty: string;
  practiceLabel: string;
  interviewSolved: boolean;
}

export interface InterviewReportDetailRow {
  title: string;
  titleSlug: string;
  practiceLabel: string;
  interviewSolved: boolean;
  secondsSpent: number;
  interviewXpEarned: number;
}

export interface InterviewReportViewModel {
  interviewName: string;
  entry: InterviewHistoryEntry;
  hubRows: InterviewHubRow[];
  reportRows: InterviewReportDetailRow[];
  plannedMinutes: number;
  actualMinutes: number;
  actualRemainderSeconds: number;
  attemptId?: string;
  solutionFolderPath?: string;
}

function mergeInterviewReportDetailRows(
  hubRows: InterviewHubRow[],
  entry: InterviewHistoryEntry
): InterviewReportDetailRow[] {
  const per = entry.perProblem ?? [];
  return hubRows.map((h) => {
    const st = per.find((p) => p.titleSlug === h.titleSlug);
    return {
      title: h.title,
      titleSlug: h.titleSlug,
      practiceLabel: h.practiceLabel,
      interviewSolved: h.interviewSolved,
      secondsSpent: st?.secondsSpent ?? 0,
      interviewXpEarned: st?.interviewXpEarned ?? 0,
    };
  });
}

export function computeActualSessionDuration(entry: InterviewHistoryEntry): {
  actualMinutes: number;
  actualRemainderSeconds: number;
} {
  const ms = Math.max(0, entry.endedAt - entry.startedAt);
  return {
    actualMinutes: Math.floor(ms / 60_000),
    actualRemainderSeconds: Math.floor((ms % 60_000) / 1000),
  };
}

export async function buildInterviewReportHubRowsForEntry(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  entry: InterviewHistoryEntry
): Promise<InterviewHubRow[]> {
  const gs = context.globalState;
  const solved = new Set(entry.solvedSlugs);
  const planned = entry.plannedProblems?.length
    ? entry.plannedProblems
    : entry.plannedSlugs.map((slug) => ({ titleSlug: slug, difficulty: "MEDIUM" }));
  const rows: InterviewHubRow[] = [];
  for (const p of planned) {
    const prob = await getProvider().getProblem(p.titleSlug);
    const title = prob?.title ?? p.titleSlug;
    const difficulty = prob?.difficulty ?? p.difficulty ?? "MEDIUM";
    const st = getStoredStatus(gs, p.titleSlug);
    const practiceLabel =
      st === "solved" ? "Solved" : st === "attempting" ? "Attempting" : "Not tracked";
    rows.push({
      titleSlug: p.titleSlug,
      title,
      difficulty,
      practiceLabel,
      interviewSolved: solved.has(p.titleSlug),
    });
  }
  return rows;
}

export async function buildInterviewReportViewModel(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  entry: InterviewHistoryEntry,
  interviewName: string,
  meta?: { attemptId?: string; solutionFolderPath?: string }
): Promise<InterviewReportViewModel> {
  const { actualMinutes, actualRemainderSeconds } = computeActualSessionDuration(entry);
  const hubRows = await buildInterviewReportHubRowsForEntry(context, getProvider, entry);
  const reportRows = mergeInterviewReportDetailRows(hubRows, entry);
  return {
    interviewName,
    entry,
    hubRows,
    reportRows,
    plannedMinutes: entry.durationMinutes,
    actualMinutes,
    actualRemainderSeconds,
    ...(meta?.attemptId ? { attemptId: meta.attemptId } : {}),
    ...(meta?.solutionFolderPath ? { solutionFolderPath: meta.solutionFolderPath } : {}),
  };
}

export function interviewReportViewModelFromSnapshotFile(
  f: LcInterviewReportFileV1
): InterviewReportViewModel {
  const e = f.entry;
  const { actualMinutes, actualRemainderSeconds } = computeActualSessionDuration(e);
  const hubRows: InterviewHubRow[] = f.hubRows.map((r) => ({
    titleSlug: r.titleSlug,
    title: r.title,
    difficulty: "",
    practiceLabel: r.practiceLabel,
    interviewSolved: r.interviewSolved,
  }));
  const reportRows: InterviewReportDetailRow[] = f.hubRows.map((r) => ({
    title: r.title,
    titleSlug: r.titleSlug,
    practiceLabel: r.practiceLabel,
    interviewSolved: r.interviewSolved,
    secondsSpent: typeof r.secondsSpent === "number" ? r.secondsSpent : 0,
    interviewXpEarned: typeof r.interviewXpEarned === "number" ? r.interviewXpEarned : 0,
  }));
  return {
    interviewName: f.interviewName,
    entry: e,
    hubRows,
    reportRows,
    plannedMinutes: e.durationMinutes,
    actualMinutes,
    actualRemainderSeconds,
    ...(typeof f.attemptId === "string" && f.attemptId.trim() ? { attemptId: f.attemptId.trim().toLowerCase() } : {}),
    ...(typeof f.solutionFolderPath === "string" && f.solutionFolderPath.trim()
      ? { solutionFolderPath: f.solutionFolderPath.trim() }
      : {}),
  };
}

let interviewSetupPanel: vscode.WebviewPanel | null = null;
let interviewReportPanel: vscode.WebviewPanel | null = null;
let interviewReportLastModel: InterviewReportViewModel | null = null;
let interviewReportGetProvider: (() => IProblemProvider) | null = null;

let interviewSetupOnStart:
  | ((msg: InterviewSetupStartMessage) => Promise<{ ok: true } | { ok: false; message: string }>)
  | null = null;
let interviewSetupOnOpenProblem: ((titleSlug: string) => Promise<void>) | null = null;
let interviewSetupGetProvider: (() => IProblemProvider) | null = null;
let interviewHubExtensionContext: vscode.ExtensionContext | null = null;

/** Days until on-disk problemset difficulty cache is ignored and refetched for stats. */
export const PROBLEMSET_DIFFICULTY_CACHE_TTL_DAYS = 7;
const PROBLEMSET_DIFFICULTY_CACHE_TTL_MS =
  PROBLEMSET_DIFFICULTY_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

const SOLUTION_EXTENSIONS = new Set(SOLUTION_FILE_EXTENSIONS);

function getEffectiveChallengePanelLanguage(context: vscode.ExtensionContext): SupportedLanguage {
  const last = context.globalState.get<string>(LAST_CHALLENGE_PANEL_LANGUAGE_KEY);
  if (last && isSupportedLanguage(last)) return last;
  const folders = vscode.workspace.workspaceFolders ?? [];
  return getEffectiveConfig(folders).language ?? "typescript";
}

/** Languages that already have a solution file on disk for this problem (id- or slug-named). */
async function languagesWithSolutionFilesOnDisk(
  context: vscode.ExtensionContext,
  problem: Problem
): Promise<SupportedLanguage[]> {
  const solutionBase = interviewSolutionBaseDir(context.globalState);
  const attemptHex = interviewSolutionAttemptHex(context.globalState);
  const found: SupportedLanguage[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const { exists } = await Database.resolveSolutionFilePathForOpen(
      undefined,
      problem.id,
      problem.titleSlug,
      solutionBase,
      attemptHex,
      lang
    );
    if (exists) found.push(lang);
  }
  return found;
}

function interviewSolutionBaseDir(globalState: vscode.Memento): string | undefined {
  const s = getInterviewSession(globalState);
  if (s?.active && s.solutionFolderPath?.trim()) {
    return s.solutionFolderPath.trim();
  }
  return undefined;
}

function interviewSolutionAttemptHex(globalState: vscode.Memento): string | undefined {
  const s = getInterviewSession(globalState);
  if (!s?.active) return undefined;
  const h = typeof s.attemptHex === "string" ? s.attemptHex.trim().toLowerCase() : "";
  return /^[0-9a-f]{3}$/.test(h) ? h : undefined;
}

/** Returns titleSlug if the active editor is a solution file for a registered problem; otherwise null. */
export function getTitleSlugForActiveSolutionFile(context: vscode.ExtensionContext): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const ext = path.extname(editor.document.uri.fsPath).toLowerCase();
  if (!SOLUTION_EXTENSIONS.has(ext)) return null;
  const editorPath = path.resolve(editor.document.uri.fsPath);
  const solutionBase = interviewSolutionBaseDir(context.globalState);
  for (const [, state] of problemViews) {
    const { idPath, slugPath } = Database.getSolutionPathSet(
      editor.document.uri,
      state.problem.id,
      state.problem.titleSlug,
      solutionBase,
      interviewSolutionAttemptHex(context.globalState)
    );
    if (editorPath === path.resolve(idPath) || editorPath === path.resolve(slugPath)) {
      return state.problem.titleSlug;
    }
  }
  return null;
}

/**
 * Creates a `*.hint` JSON file beside the solution if missing, then opens it (custom Analysis editor).
 */
export async function openHintFileForProblem(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  titleSlug?: string
): Promise<void> {
  await ensureProblemCacheLoaded(context);
  const slug = titleSlug?.trim() ?? getTitleSlugForActiveSolutionFile(context);
  if (!slug) {
    vscode.window.showWarningMessage("Open a problem from the list or a solution file first.");
    return;
  }
  let problem = getCachedProblem(slug);
  if (!problem) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Loading problem…" },
      async () => {
        const p = await getProvider().getProblem(slug);
        if (p) {
          setCachedProblem(slug, p, context);
          problem = p;
        }
      }
    );
  }
  if (!problem) {
    vscode.window.showErrorMessage("Could not load problem. Open it from the practice panel or check the slug.");
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage("Open a workspace folder first.");
    return;
  }
  const solutionBase = interviewSolutionBaseDir(context.globalState);
  const attemptHex = interviewSolutionAttemptHex(context.globalState);
  const baseUri = vscode.window.activeTextEditor?.document.uri;
  const { path: hintPath, exists } = await Database.resolveHintFilePathForOpen(
    baseUri,
    problem.id,
    problem.titleSlug,
    solutionBase,
    attemptHex
  );
  const uri = vscode.Uri.file(hintPath);
  const body = createDefaultHintFileJson(problem.titleSlug, problem.title);
  try {
    await fs.mkdir(path.dirname(hintPath), { recursive: true });
  } catch (e) {
    Logger.logError("Hint file: could not create parent directory", e);
    vscode.window.showErrorMessage(
      `Could not create folder for hint file: ${path.dirname(hintPath)}`
    );
    return;
  }
  if (!exists) {
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(body, "utf8"));
    } catch (e) {
      Logger.logError("Hint file: workspace write failed, retrying with fs", e);
      try {
        await fs.writeFile(hintPath, body, "utf-8");
      } catch (e2) {
        Logger.logError("Hint file: write failed", e2);
        vscode.window.showErrorMessage(
          `Could not create ${path.basename(hintPath)}. Check folder permissions and workspace trust.`
        );
        return;
      }
    }
  }
  try {
    await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
  } catch {
    /* explorer command may be unavailable */
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

/** Numeric problem id from active solution tab (e.g. `2813.ts` → `2813`). */
function numericIdFromActiveSolutionEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const ext = path.extname(editor.document.fileName).toLowerCase();
  if (!SOLUTION_FILE_EXTENSIONS.includes(ext)) return undefined;
  const base = path.basename(editor.document.fileName, ext);
  return /^\d+$/.test(base) ? base : undefined;
}

/** Slug basename from active solution tab (e.g. `two-sum.ts` → `two-sum`). */
function slugBasenameFromActiveSolutionEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const ext = path.extname(editor.document.fileName).toLowerCase();
  if (!SOLUTION_FILE_EXTENSIONS.includes(ext)) return undefined;
  const base = path.basename(editor.document.fileName, ext);
  return /^[a-z0-9-]+$/i.test(base) && !/^\d+$/.test(base) ? base : undefined;
}

/**
 * If a `.hint` file already exists for this problem (by **numeric id** and/or **slug** path), open it and return true.
 * Otherwise return false (caller may open agent chat).
 * Resolves paths even when the problem API is unavailable, using the open solution file name + panel slug.
 */
export async function tryOpenExistingHintFile(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  titleSlug?: string
): Promise<boolean> {
  await ensureProblemCacheLoaded(context);
  const slugArg = titleSlug?.trim();
  const slugFromPanel = getTitleSlugForActiveSolutionFile(context);
  const slug = slugArg ?? slugFromPanel ?? undefined;

  let problem: Problem | undefined = slug ? getCachedProblem(slug) : undefined;
  if (slug && !problem) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Loading problem…" },
      async () => {
        const p = await getProvider().getProblem(slug);
        if (p) {
          setCachedProblem(slug, p, context);
          problem = p;
        }
      }
    );
  }

  if (!vscode.workspace.workspaceFolders?.length) {
    return false;
  }
  const solutionBase = interviewSolutionBaseDir(context.globalState);
  const attemptHex = interviewSolutionAttemptHex(context.globalState);

  let problemIdStr: string;
  let titleSlugStr: string;

  if (problem) {
    problemIdStr = String(problem.id);
    titleSlugStr = problem.titleSlug;
  } else {
    const numId = numericIdFromActiveSolutionEditor();
    const slugFromFile = slugBasenameFromActiveSolutionEditor();
    const s = slugArg ?? slugFromPanel ?? slugFromFile ?? "";
    if (!numId && !s) {
      return false;
    }
    problemIdStr = numId ?? s;
    titleSlugStr = s || numId || "";
  }

  const baseUri = vscode.window.activeTextEditor?.document.uri;
  const { path: hintPath, exists } = await Database.resolveHintFilePathForOpen(
    baseUri,
    problemIdStr,
    titleSlugStr,
    solutionBase,
    attemptHex
  );
  if (!exists) {
    return false;
  }
  const uri = vscode.Uri.file(hintPath);
  try {
    await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
  } catch {
    /* */
  }
  await vscode.window.showTextDocument(uri, { preview: false });
  return true;
}

/** In-memory cache of problem data (by titleSlug) for instant show and soft reload. */
const problemCache = new Map<string, Problem>();

/** True after we have loaded from disk once this session; avoids re-reading on every open. */
let problemCacheLoadedFromDisk = false;

const CACHE_FILENAME = "problem-cache.json";

/** Single viewType so we can register one serializer to restore panels after window reload. */
export const PROBLEM_WEBVIEW_VIEWTYPE = "leetcodeProblem";

/** Avoid hanging forever on network during panel restore after window reload. */
const RESTORE_FETCH_TIMEOUT_MS = 30_000;

const RESTORE_LOADING_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;}</style></head>
<body><p>Loading problem…</p></body></html>`;

async function fetchProblemForRestore(
  getProvider: () => IProblemProvider,
  titleSlug: string
): Promise<Problem | null | undefined> {
  const pending = getProvider().getProblem(titleSlug);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => resolve(undefined), RESTORE_FETCH_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([pending, timeout]);
    return result;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

const WEBVIEW_OPTIONS: vscode.WebviewPanelOptions & {
  enableScripts?: boolean;
} = {
  enableScripts: true,
  retainContextWhenHidden: true,
};

const LOGO_URI = (context: vscode.ExtensionContext) =>
  vscode.Uri.joinPath(context.extensionUri, "icons", "logo-dark-16.png");

function getProblemWebviewOptions(
  context: vscode.ExtensionContext
): vscode.WebviewPanelOptions & { enableScripts?: boolean } {
  const iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
  return { ...WEBVIEW_OPTIONS, iconPath } as vscode.WebviewPanelOptions & { enableScripts?: boolean };
}

function getCacheUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILENAME);
}

function getCachedProblem(titleSlug: string): Problem | undefined {
  return problemCache.get(titleSlug);
}

/** Title for a slug when the problem was loaded into the session cache. */
export function getCachedProblemTitle(titleSlug: string): string | undefined {
  return getCachedProblem(titleSlug)?.title;
}

/** For gamification / XP without importing the full panel registry elsewhere. */
export function getCachedProblemDifficulty(titleSlug: string): string | undefined {
  return getCachedProblem(titleSlug)?.difficulty;
}

/** Sync lookup of the numeric problem ID for a titleSlug from the session cache. */
export function getCachedProblemId(titleSlug: string): string | undefined {
  return getCachedProblem(titleSlug)?.id;
}

export function notifyAllProblemPanelsUiMode(context: vscode.ExtensionContext): void {
  const focusCompact = context.globalState.get<boolean>(FOCUS_COMPACT_WEBVIEW_KEY) ?? false;
  const interviewMode = Boolean(getInterviewSession(context.globalState)?.active);
  for (const [, state] of problemViews) {
    try {
      void state.webviewPanel.webview.postMessage({
        event: "uiMode",
        focusCompact,
        interviewMode,
      });
    } catch {
      // Panel disposed; cleanup happens elsewhere via onDidDispose.
    }
  }
}

/** Normalize LeetCode difficulty strings (e.g. EASY / Easy) for stats bucketing. */
function difficultyBucketFromRaw(raw: string | undefined): "Easy" | "Medium" | "Hard" | null {
  if (raw === undefined || raw === "") return null;
  const u = raw.trim().toUpperCase();
  if (u === "EASY") return "Easy";
  if (u === "MEDIUM") return "Medium";
  if (u === "HARD") return "Hard";
  return null;
}

/** Human-readable duration for stats UI (hours + minutes). */
function formatDurationMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min";
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min} min`;
  if (min === 0) return `${h} h`;
  return `${h} h ${min} min`;
}

interface StatsDayRow {
  date: string;
  totalMinutes: number;
  solvedCount: number;
  breakdown: Array<{
    slug: string;
    title: string;
    minutes: number;
    durationLabel: string;
    timeNote?: string;
  }>;
}

interface StatsChartBar {
  x: number;
  y: number;
  w: number;
  h: number;
  date: string;
  value: number;
}

/** Shared with stats.ejs SVG baseline / polyline scale. */
interface StatsChartAxis {
  x1: number;
  x2: number;
  yBottom: number;
  labelY: number;
}

interface StatsTimeAnalysis {
  /** Sum of all per-day timer ticks (no cumulative fallback); best “real” tracked time. */
  totalMinutesTimerOnly: number;
  totalTimerLabel: string;
  /** Sum of each row’s minutes as shown in the list (can over-count if cumulative time appears on multiple days). */
  totalMinutesDailyRowsSum: number;
  totalDailyRowsLabel: string;
  mostActiveDate: string | null;
  mostActiveMinutes: number;
  mostActiveLabel: string;
  daysWithPracticeTime: number;
  avgMinutesOnPracticeDays: number;
  avgPracticeDaysLabel: string;
  peakSolvedDate: string | null;
  peakSolvedCount: number;
  /** Max minutes in range (chart scale). */
  chartTimeMaxMinutes: number;
  chartTimeMaxLabel: string;
  /** Max solved count in range (chart scale). */
  chartSolvedMax: number;
}

function buildStatsChartsAndAnalysis(
  rows: StatsDayRow[],
  totalSecTimerOnly: number
): {
  chrono: StatsDayRow[];
  timeAnalysis: StatsTimeAnalysis | null;
  timeChartBars: StatsChartBar[];
  solvedChartBars: StatsChartBar[];
  chartViewBox: string;
  chartAxis: StatsChartAxis;
  xLabelIndices: number[];
  timeLinePoints: string;
  solvedLinePoints: string;
} {
  if (rows.length === 0) {
    return {
      chrono: [],
      timeAnalysis: null,
      timeChartBars: [],
      solvedChartBars: [],
      chartViewBox: "0 0 1000 200",
      chartAxis: { x1: 52, x2: 980, yBottom: 164, labelY: 194 },
      xLabelIndices: [],
      timeLinePoints: "",
      solvedLinePoints: "",
    };
  }

  const chrono = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const totalMinutesTimerOnly = Math.round(totalSecTimerOnly / 60);
  const totalMinutesDailyRows = rows.reduce((s, d) => s + d.totalMinutes, 0);

  let mostActive = chrono[0];
  for (const d of chrono) {
    if (d.totalMinutes > mostActive.totalMinutes) mostActive = d;
  }

  let peakSolved = chrono[0];
  for (const d of chrono) {
    if (d.solvedCount > peakSolved.solvedCount) peakSolved = d;
  }

  const daysWithTime = chrono.filter((d) => d.totalMinutes > 0);
  const avgMinutesOnPracticeDays =
    daysWithTime.length > 0
      ? Math.round(
          daysWithTime.reduce((s, d) => s + d.totalMinutes, 0) / daysWithTime.length
        )
      : 0;

  const chartW = 1000;
  const chartH = 200;
  const padL = 52;
  const padR = 20;
  const padT = 16;
  const padB = 36;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const chartAxis: StatsChartAxis = {
    x1: padL,
    x2: padL + innerW,
    yBottom: padT + innerH,
    labelY: chartH - 6,
  };
  const n = chrono.length;
  const maxM = Math.max(...chrono.map((d) => d.totalMinutes), 1);
  const maxS = Math.max(...chrono.map((d) => d.solvedCount), 1);
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.72));

  const timeChartBars: StatsChartBar[] = chrono.map((d, i) => {
    const h = maxM > 0 ? (d.totalMinutes / maxM) * innerH : 0;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + innerH - h;
    return { x, y, w: barW, h, date: d.date, value: d.totalMinutes };
  });

  const solvedChartBars: StatsChartBar[] = chrono.map((d, i) => {
    const h = maxS > 0 ? (d.solvedCount / maxS) * innerH : 0;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + innerH - h;
    return { x, y, w: barW, h, date: d.date, value: d.solvedCount };
  });

  const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : n <= 48 ? 4 : Math.ceil(n / 12);
  const xLabelIndices: number[] = [];
  for (let i = 0; i < n; i += labelStep) xLabelIndices.push(i);
  if (xLabelIndices.length === 0 || xLabelIndices[xLabelIndices.length - 1] !== n - 1) {
    if (!xLabelIndices.includes(n - 1)) xLabelIndices.push(n - 1);
  }

  const timeAnalysis: StatsTimeAnalysis = {
    totalMinutesTimerOnly,
    totalTimerLabel: formatDurationMinutes(totalMinutesTimerOnly),
    totalMinutesDailyRowsSum: totalMinutesDailyRows,
    totalDailyRowsLabel: formatDurationMinutes(totalMinutesDailyRows),
    mostActiveDate: mostActive.totalMinutes > 0 ? mostActive.date : null,
    mostActiveMinutes: mostActive.totalMinutes,
    mostActiveLabel:
      mostActive.totalMinutes > 0
        ? `${mostActive.date} · ${formatDurationMinutes(mostActive.totalMinutes)}`
        : "—",
    daysWithPracticeTime: daysWithTime.length,
    avgMinutesOnPracticeDays,
    avgPracticeDaysLabel: formatDurationMinutes(avgMinutesOnPracticeDays),
    peakSolvedDate: peakSolved.solvedCount > 0 ? peakSolved.date : null,
    peakSolvedCount: peakSolved.solvedCount,
    chartTimeMaxMinutes: maxM,
    chartTimeMaxLabel: formatDurationMinutes(maxM),
    chartSolvedMax: maxS,
  };

  const timeLinePoints =
    timeChartBars.length > 1
      ? timeChartBars.map((b) => `${(b.x + b.w / 2).toFixed(2)},${b.y.toFixed(2)}`).join(" ")
      : "";
  const solvedLinePoints =
    solvedChartBars.length > 1
      ? solvedChartBars.map((b) => `${(b.x + b.w / 2).toFixed(2)},${b.y.toFixed(2)}`).join(" ")
      : "";

  return {
    chrono,
    timeAnalysis,
    timeChartBars,
    solvedChartBars,
    chartViewBox: `0 0 ${chartW} ${chartH}`,
    chartAxis,
    xLabelIndices,
    timeLinePoints,
    solvedLinePoints,
  };
}

/** Loads cache from JSON file into memory. Only reads disk once per session. */
async function ensureProblemCacheLoaded(
  context: vscode.ExtensionContext
): Promise<void> {
  if (problemCacheLoadedFromDisk) return;
  problemCacheLoadedFromDisk = true;
  try {
    const uri = getCacheUri(context);
    const buf = await vscode.workspace.fs.readFile(uri);
    const raw = JSON.parse(Buffer.from(buf).toString("utf8")) as Record<
      string,
      Problem
    >;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [slug, p] of Object.entries(raw)) {
        if (slug && p && typeof p.titleSlug === "string") {
          problemCache.set(slug, p as Problem);
        }
      }
    }
  } catch {
    // No file or invalid JSON: in-memory cache stays as-is
  }
}

/** Writes in-memory cache to JSON file. */
async function persistProblemCache(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const uri = getCacheUri(context);
    const obj = Object.fromEntries(problemCache);
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(obj), "utf8")
    );
  } catch {
    // Ignore write errors
  }
}

function setCachedProblem(
  titleSlug: string,
  problem: Problem,
  context?: vscode.ExtensionContext
): void {
  problemCache.set(titleSlug, problem);
  if (context) {
    persistProblemCache(context).catch(() => {});
  }
}

const PROBLEMSET_DIFFICULTY_CACHE_FILENAME = "problemset-difficulty-cache.json";
/** Beyond this many unknown slugs, one full problemset pagination is fewer HTTP round-trips. */
const PROBLEMSET_FULL_LIST_MISSING_THRESHOLD = 200;
const PARALLEL_DIFFICULTY_CONCURRENCY = 12;

interface ProblemsetDifficultyDiskCache {
  updatedAt: number;
  difficulties: Record<string, string>;
}

async function loadProblemsetDifficultyDiskMap(
  context: vscode.ExtensionContext
): Promise<Map<string, string>> {
  try {
    const uri = vscode.Uri.joinPath(
      context.globalStorageUri,
      PROBLEMSET_DIFFICULTY_CACHE_FILENAME
    );
    const buf = await vscode.workspace.fs.readFile(uri);
    const j = JSON.parse(Buffer.from(buf).toString("utf8")) as ProblemsetDifficultyDiskCache;
    if (typeof j.updatedAt !== "number" || Date.now() - j.updatedAt > PROBLEMSET_DIFFICULTY_CACHE_TTL_MS) {
      return new Map();
    }
    if (j.difficulties && typeof j.difficulties === "object" && !Array.isArray(j.difficulties)) {
      return new Map(Object.entries(j.difficulties));
    }
  } catch {
    // missing or invalid file
  }
  return new Map();
}

/** Deletes on-disk difficulty cache so stats refetches from LeetCode (manual refresh or after TTL). */
export async function clearProblemsetDifficultyCacheFile(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const uri = vscode.Uri.joinPath(
      context.globalStorageUri,
      PROBLEMSET_DIFFICULTY_CACHE_FILENAME
    );
    await vscode.workspace.fs.delete(uri, { useTrash: false });
  } catch {
    // ENOENT / not found
  }
}

/** Clears cached difficulty data and reloads the stats webview if it is open. */
export async function refreshStatsData(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento
): Promise<void> {
  await clearProblemsetDifficultyCacheFile(context);
  const panel = statsWebviewPanel;
  if (panel) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Refreshing stats…",
      },
      async () => {
        try {
          panel.webview.html = await renderStatsHtml(context, globalState, panel.webview);
        } catch {
          // Webview was disposed while loading
        }
      }
    );
    try {
      panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One);
    } catch {
      // Panel closed during refresh
    }
    void vscode.window.showInformationMessage(
      "LeetCode stats refreshed (difficulty cache cleared and reloaded)."
    );
  } else {
    void vscode.window.showInformationMessage(
      "LeetCode stats difficulty cache cleared. Open “LeetCode: View Stats” to load fresh data."
    );
  }
}

async function saveProblemsetDifficultyDiskMap(
  context: vscode.ExtensionContext,
  map: Map<string, string>
): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const uri = vscode.Uri.joinPath(
      context.globalStorageUri,
      PROBLEMSET_DIFFICULTY_CACHE_FILENAME
    );
    const payload: ProblemsetDifficultyDiskCache = {
      updatedAt: Date.now(),
      difficulties: Object.fromEntries(map),
    };
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(payload), "utf8"));
  } catch {
    // ignore
  }
}

async function mergeQuestionDifficultiesParallel(
  slugs: string[],
  lc: LeetCodeProvider,
  into: Map<string, string>,
  concurrency: number
): Promise<void> {
  if (slugs.length === 0) return;
  let index = 0;
  const nWorkers = Math.max(1, Math.min(concurrency, slugs.length));
  const worker = async () => {
    while (true) {
      const i = index++;
      if (i >= slugs.length) break;
      const slug = slugs[i]!;
      const d = await lc.getQuestionDifficultyOnly(slug);
      if (d) into.set(slug, d);
    }
  };
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));
}

/**
 * Disk-backed slug → difficulty for stats. Parallel lightweight GraphQL when few gaps;
 * full problemset only when many slugs are unknown at once (first huge backlog).
 */
async function resolveProblemsetDifficultyMap(
  context: vscode.ExtensionContext,
  solvedSlugs: string[]
): Promise<Map<string, string>> {
  const diskMap = await loadProblemsetDifficultyDiskMap(context);
  const missing: string[] = [];
  for (const slug of solvedSlugs) {
    if (difficultyBucketFromRaw(getCachedProblem(slug)?.difficulty)) continue;
    if (difficultyBucketFromRaw(diskMap.get(slug))) continue;
    missing.push(slug);
  }
  if (missing.length === 0) return diskMap;

  const lc = new LeetCodeProvider();
  if (missing.length > PROBLEMSET_FULL_LIST_MISSING_THRESHOLD) {
    const list = await lc.getFullProblemsetList();
    for (const q of list) {
      diskMap.set(q.titleSlug, q.difficulty);
    }
    await saveProblemsetDifficultyDiskMap(context, diskMap);
    return diskMap;
  }

  await mergeQuestionDifficultiesParallel(missing, lc, diskMap, PARALLEL_DIFFICULTY_CONCURRENCY);
  await saveProblemsetDifficultyDiskMap(context, diskMap);
  return diskMap;
}

function getTemplatesDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "out", "templates");
}

async function solutionFileExists(
  context: vscode.ExtensionContext,
  problem: Problem,
  language?: SupportedLanguage
): Promise<boolean> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const lang = language ?? getEffectiveChallengePanelLanguage(context);
  const { exists } = await Database.resolveSolutionFilePathForOpen(
    uri,
    problem.id,
    problem.titleSlug,
    interviewSolutionBaseDir(context.globalState),
    interviewSolutionAttemptHex(context.globalState),
    lang
  );
  return exists;
}

async function renderChallengeHtml(
  context: vscode.ExtensionContext,
  problem: Problem,
  status: ProblemStatus | undefined,
  isLoggedIn: boolean | undefined,
  _webview: vscode.Webview
): Promise<string> {
  const templatesDir = getTemplatesDir(context);
  const content = problem.content || "<p>No description.</p>";
  const difficulty = problem.difficulty || "Unknown";
  const panelLanguage = getEffectiveChallengePanelLanguage(context);
  const hasSolution = await solutionFileExists(context, problem, panelLanguage);
  const isSolved = status === "solved";
  const langsOnDisk = await languagesWithSolutionFilesOnDisk(context, problem);
  const otherSolutionLangs = langsOnDisk.map((id) => ({ id, short: LANGUAGE_SHORT[id] }));

  let solutionContent: string | undefined;
  let solutionHtml: string | undefined;
  let solutionLang: string | undefined;
  if (isSolved) {
    const { path: solutionPath, exists } = await Database.resolveSolutionFilePathForOpen(
      vscode.window.activeTextEditor?.document.uri,
      problem.id,
      problem.titleSlug,
      interviewSolutionBaseDir(context.globalState),
      interviewSolutionAttemptHex(context.globalState),
      panelLanguage
    );
    if (exists) {
      try {
        const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(solutionPath));
        const raw = Buffer.from(buf).toString("utf8");
        solutionContent = raw;
        const ext = path.extname(solutionPath).toLowerCase();
        const lang = languageStrategyFromExtension(ext)?.shikiLang ?? "typescript";
        const theme =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
            ? "light-plus"
            : "dark-plus";
        const { highlightCode } = await import("./shikiLite");
        solutionHtml = highlightCode(raw, lang, theme);
      } catch {
        solutionHtml = undefined;
      }
    }
  }

  const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
  const note = notesMap[problem.titleSlug] ?? "";
  const focusCompact = context.globalState.get<boolean>(FOCUS_COMPACT_WEBVIEW_KEY) ?? false;
  const interviewSession = getInterviewSession(context.globalState);
  const interviewMode = Boolean(interviewSession?.active);
  const interviewSolvedInSession =
    interviewMode &&
    Array.isArray(interviewSession?.solvedDuringSession) &&
    interviewSession.solvedDuringSession.includes(problem.titleSlug);
  const companyLookup = lookupCompaniesProblem(context.extensionPath, problem.titleSlug);
  const topics = companyLookup?.topics ?? [];
  const companies = companyLookup?.companies ?? [];
  return ejs.renderFile(path.join(templatesDir, "challenge.ejs"), {
    id: problem.id,
    title: problem.title,
    titleSlug: problem.titleSlug,
    difficulty,
    isSolved,
    isLoggedIn: isLoggedIn ?? false,
    content,
    hasSolution,
    sampleTestCase: problem.sampleTestCase ?? "",
    note,
    solutionContent,
    solutionHtml,
    focusCompact,
    interviewMode,
    interviewSolvedInSession,
    panelLanguage,
    languageChoices: LANGUAGE_CHOICES,
    otherSolutionLangs,
    topics,
    companies,
  });
}

function dayBefore(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function computeStreak(entries: Record<string, StoredStatusEntry>): number {
  const solvedAts = Object.values(entries)
    .filter((e) => e.status === "solved" && e.solvedAt)
    .map((e) => e.solvedAt!);
  const dates = [...new Set(solvedAts)].sort().reverse();
  if (dates.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = dayBefore(today);
  if (dates[0] !== today && dates[0] !== yesterday) return 0;
  let count = 1;
  let prev = dates[0];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === dayBefore(prev)) {
      count++;
      prev = dates[i];
    } else break;
  }
  return count;
}

async function renderStatsHtml(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento,
  webview: vscode.Webview
): Promise<string> {
  await ensureProblemCacheLoaded(context);
  const entries = getAllStatusEntries(globalState);
  const session = Database.getSession(context);
  const leetcodeProfilePromise =
    session?.cookie?.trim()
      ? new LeetCodeProvider()
          .getUserProfileAndStats(session.cookie)
          .catch(() => null)
      : Promise.resolve(null);

  const solved = Object.entries(entries).filter(([, e]) => e.status === "solved");
  const attempting = Object.values(entries).filter((e) => e.status === "attempting").length;

  /** Problems only appear in disk cache after being opened; backfilled solves use disk + LeetCode. */
  const needsProblemsetDifficulty = solved.some(
    ([slug]) => difficultyBucketFromRaw(getCachedProblem(slug)?.difficulty) === null
  );
  let problemsetDifficultyBySlug: Map<string, string> | undefined;
  if (needsProblemsetDifficulty) {
    problemsetDifficultyBySlug = await resolveProblemsetDifficultyMap(
      context,
      solved.map(([s]) => s)
    );
  }

  let easySolved = 0;
  let mediumSolved = 0;
  let hardSolved = 0;
  for (const [slug] of solved) {
    let bucket = difficultyBucketFromRaw(getCachedProblem(slug)?.difficulty);
    if (bucket === null && problemsetDifficultyBySlug) {
      bucket = difficultyBucketFromRaw(problemsetDifficultyBySlug.get(slug));
    }
    if (bucket === "Easy") easySolved++;
    else if (bucket === "Medium") mediumSolved++;
    else if (bucket === "Hard") hardSolved++;
  }
  const totalSolved = solved.length;
  const streak = computeStreak(entries);

  const timerByDay = globalState.get<TimerByDay>(TIMER_BY_DAY_KEY) ?? {};
  const timerElapsed =
    globalState.get<Record<string, { elapsed: number }>>(TIMER_ELAPSED_KEY) ?? {};

  const solvedByDate: Record<string, number> = {};
  /** titleSlugs solved on each calendar day (from backfill / mark-as-solved) */
  const solvedSlugsByDate: Record<string, string[]> = {};
  for (const [slug, e] of Object.entries(entries)) {
    if (e.status === "solved" && e.solvedAt) {
      solvedByDate[e.solvedAt] = (solvedByDate[e.solvedAt] ?? 0) + 1;
      if (!solvedSlugsByDate[e.solvedAt]) solvedSlugsByDate[e.solvedAt] = [];
      solvedSlugsByDate[e.solvedAt].push(slug);
    }
  }
  const allDates = new Set<string>([
    ...Object.keys(timerByDay),
    ...Object.keys(solvedByDate),
  ]);
  const statsByDaySorted = Array.from(allDates)
    .map((date) => {
      const bySlug = timerByDay[date] ?? {};
      const solvedOnDay = solvedSlugsByDate[date] ?? [];
      const slugSet = new Set<string>([...Object.keys(bySlug), ...solvedOnDay]);

      const breakdown = Array.from(slugSet)
        .map((slug) => {
          const daySec = bySlug[slug] ?? 0;
          const cumulativeSec = timerElapsed[slug]?.elapsed ?? 0;
          const sec = daySec > 0 ? daySec : cumulativeSec;
          const minutes = Math.round(sec / 60);
          return {
            slug,
            title: getCachedProblem(slug)?.title ?? slug,
            minutes,
            durationLabel: formatDurationMinutes(minutes),
            /** Shown when minutes come from per-problem cumulative timer (no per-day ticks) */
            timeNote:
              daySec > 0
                ? undefined
                : cumulativeSec > 0
                  ? "total tracked"
                  : undefined,
          };
        })
        .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title));

      const totalSec = Array.from(slugSet).reduce((sum, slug) => {
        const daySec = bySlug[slug] ?? 0;
        const cumulativeSec = timerElapsed[slug]?.elapsed ?? 0;
        return sum + (daySec > 0 ? daySec : cumulativeSec);
      }, 0);

      const totalMinutes = Math.round(totalSec / 60);
      return {
        date,
        totalMinutes,
        totalDurationLabel: formatDurationMinutes(totalMinutes),
        solvedCount: solvedByDate[date] ?? 0,
        breakdown,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const timeChartMaxMinutes =
    statsByDaySorted.length > 0 ? Math.max(...statsByDaySorted.map((d) => d.totalMinutes), 1) : 1;

  let totalSecTimerOnly = 0;
  for (const dayMap of Object.values(timerByDay)) {
    for (const sec of Object.values(dayMap)) {
      totalSecTimerOnly += sec;
    }
  }
  const {
    chrono: statsChrono,
    timeAnalysis,
    timeChartBars,
    solvedChartBars,
    chartViewBox,
    chartAxis,
    xLabelIndices,
    timeLinePoints,
    solvedLinePoints,
  } = buildStatsChartsAndAnalysis(statsByDaySorted as StatsDayRow[], totalSecTimerOnly);

  const leetcodeProfile = await leetcodeProfilePromise;

  const today = todayIso();
  const dailyGoal = getDailyGoal(globalState);
  let dailyGoalSection:
    | { label: string; current: number; target: number; percent: number }
    | undefined;
  if (dailyGoal) {
    if (dailyGoal.mode === "problems") {
      const cur = countSolvedToday(entries, today);
      dailyGoalSection = {
        label: "Problems solved today",
        current: cur,
        target: dailyGoal.target,
        percent: dailyGoalProgressPercent(cur, dailyGoal.target),
      };
    } else {
      const cur = sumTimerMinutesToday(timerByDay, today);
      dailyGoalSection = {
        label: "Practice minutes today",
        current: cur,
        target: dailyGoal.target,
        percent: dailyGoalProgressPercent(cur, dailyGoal.target),
      };
    }
  }
  const totalXp = getTotalXp(globalState);
  const xpProg = xpLevelProgress(totalXp);
  const interviewHistory = getInterviewHistory(globalState);

  const templatesDir = getTemplatesDir(context);
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "icons", "logo-dark.png")
  ).toString();
  return ejs.renderFile(path.join(templatesDir, "stats.ejs"), {
    totalSolved,
    easySolved,
    mediumSolved,
    hardSolved,
    attempting,
    streak,
    leetcodeProfile,
    logoUri,
    statsByDaySorted,
    timeChartMaxMinutes,
    formatDuration: formatDurationMinutes,
    timeAnalysis,
    statsChrono,
    timeChartBars,
    solvedChartBars,
    chartViewBox,
    chartAxis,
    xLabelIndices,
    timeLinePoints,
    solvedLinePoints,
    statsCacheHint: `LeetCode difficulty cache expires after ${PROBLEMSET_DIFFICULTY_CACHE_TTL_DAYS} days. Command Palette: “LeetCode: Refresh Stats Data” to clear cache and reload now.`,
    dailyGoalSection,
    totalXp,
    xpLevel: xpProg.level,
    xpInLevel: xpProg.xpInLevel,
    xpNeededForNext: xpProg.xpNeededForNext,
    interviewHistory,
  });
}

export async function openStatsWebview(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento
): Promise<void> {
  const iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
  const load = (w: vscode.Webview) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Loading stats…" },
      () => renderStatsHtml(context, globalState, w)
    );

  if (statsWebviewPanel) {
    try {
      statsWebviewPanel.reveal(statsWebviewPanel.viewColumn ?? vscode.ViewColumn.One);
      statsWebviewPanel.webview.html = await load(statsWebviewPanel.webview);
      return;
    } catch {
      statsWebviewPanel = null;
    }
  }

  const panel = vscode.window.createWebviewPanel(
    "leetcodeStats",
    "LeetCode Practice Stats",
    vscode.ViewColumn.One,
    { enableScripts: false, iconPath } as vscode.WebviewPanelOptions
  );
  statsWebviewPanel = panel;
  panel.onDidDispose(() => {
    if (statsWebviewPanel === panel) {
      statsWebviewPanel = null;
    }
  });
  panel.webview.html = await load(panel.webview);
}

async function buildInterviewHubRows(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  session: InterviewSessionState
): Promise<InterviewHubRow[]> {
  const gs = context.globalState;
  const solvedInInterview = new Set(session.solvedDuringSession);
  const rows: InterviewHubRow[] = [];
  for (const p of session.plannedProblems) {
    const prob = await getProvider().getProblem(p.titleSlug);
    const title = prob?.title ?? p.titleSlug;
    const difficulty = prob?.difficulty ?? p.difficulty ?? "MEDIUM";
    const st = getStoredStatus(gs, p.titleSlug);
    const practiceLabel =
      st === "solved" ? "Solved" : st === "attempting" ? "Attempting" : "Not tracked";
    rows.push({
      titleSlug: p.titleSlug,
      title,
      difficulty,
      practiceLabel,
      interviewSolved: solvedInInterview.has(p.titleSlug),
    });
  }
  return rows;
}

async function renderInterviewSetupHtml(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider
): Promise<string> {
  const templatesDir = getTemplatesDir(context);
  const session = getInterviewSession(context.globalState);
  if (!session?.active) {
    return String(
      await ejs.renderFile(path.join(templatesDir, "interview-setup.ejs"), { sessionMode: false })
    );
  }
  const hubRows = await buildInterviewHubRows(context, getProvider, session);
  return String(
    await ejs.renderFile(path.join(templatesDir, "interview-setup.ejs"), {
      sessionMode: true,
      session,
      hubRows,
      endsAt: session.endsAt,
    })
  );
}

export async function renderInterviewReportHtml(
  context: vscode.ExtensionContext,
  model: InterviewReportViewModel
): Promise<string> {
  const templatesDir = getTemplatesDir(context);
  const entry = model.entry;
  const aid = model.attemptId?.trim().toLowerCase() ?? "";
  const folder = model.solutionFolderPath?.trim() ?? "";
  const canOpenAttemptSolutions = Boolean(aid && /^[0-9a-f]{3}$/.test(aid) && folder);
  return String(
    await ejs.renderFile(path.join(templatesDir, "interview-report.ejs"), {
      interviewName: model.interviewName,
      reportRows: model.reportRows,
      plannedMinutes: model.plannedMinutes,
      actualMinutes: model.actualMinutes,
      actualRemainderSeconds: model.actualRemainderSeconds,
      plannedCount: entry.plannedCount,
      solvedCount: entry.solvedCount,
      bonusXp: entry.bonusXp,
      xpBreakdown: entry.xpBreakdown,
      canOpenAttemptSolutions,
    })
  );
}

export async function openInterviewAttemptSolutionFile(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  model: InterviewReportViewModel,
  titleSlug: string
): Promise<void> {
  const slug = titleSlug.trim();
  const aid = model.attemptId?.trim().toLowerCase();
  const folder = model.solutionFolderPath?.trim();
  if (!slug || !aid || !folder || !/^[0-9a-f]{3}$/.test(aid)) {
    return;
  }
  let prob = getCachedProblem(slug);
  if (!prob) {
    const p = await getProvider().getProblem(slug);
    if (p) {
      setCachedProblem(slug, p, context);
      prob = p;
    }
  }
  if (!prob) {
    void vscode.window.showWarningMessage("Could not resolve problem.");
    return;
  }
  const { path: fp, exists } = await Database.resolveSolutionFilePathForOpen(
    undefined,
    prob.id,
    prob.titleSlug,
    path.resolve(folder),
    aid
  );
  if (!exists) {
    void vscode.window.showInformationMessage("No solution file for this attempt.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fp));
  await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false,
  });
}

function ensureInterviewSetupPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (interviewSetupPanel) {
    return interviewSetupPanel;
  }
  const iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
  const panel = vscode.window.createWebviewPanel(
    "leetcodeInterviewSetup",
    "LeetCode — Interview setup",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, iconPath } as vscode.WebviewPanelOptions
  );
  interviewSetupPanel = panel;
  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const m = raw as InterviewSetupStartMessage | InterviewSetupOpenProblemMessage;
    if (!m || typeof m !== "object") return;
    if (m.type === "start") {
      const fn = interviewSetupOnStart;
      if (!fn) return;
      const result = await fn(m);
      if (!result.ok) {
        try { void panel.webview.postMessage({ type: "resetStart", message: result.message }); }
        catch { /* panel disposed mid-await */ }
      }
      return;
    }
    if (m.type === "openProblem" && m.titleSlug) {
      const openFn = interviewSetupOnOpenProblem;
      if (openFn) {
        await openFn(m.titleSlug.trim());
      }
    }
  });
  panel.onDidDispose(() => {
    if (interviewSetupPanel === panel) {
      interviewSetupPanel = null;
    }
    const ctx = interviewHubExtensionContext;
    const gp = interviewSetupGetProvider;
    if (ctx && gp && getInterviewSession(ctx.globalState)) {
      void vscode.window.showWarningMessage(
        "Interview is still running — reopening the interview hub."
      );
      setImmediate(() => {
        if (!interviewSetupOnStart || !interviewSetupOnOpenProblem) return;
        openInterviewSetupWebview(
          ctx,
          { onStart: interviewSetupOnStart, onOpenProblem: interviewSetupOnOpenProblem },
          gp
        );
      });
    }
  });
  return panel;
}

export async function refreshInterviewHubIfOpen(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider
): Promise<void> {
  const panel = interviewSetupPanel;
  if (!panel) return;
  const session = getInterviewSession(context.globalState);
  panel.title = session?.active ? "LeetCode — Interview" : "LeetCode — Interview setup";
  panel.webview.html = await renderInterviewSetupHtml(context, getProvider);
}

export function openInterviewSetupWebview(
  context: vscode.ExtensionContext,
  handlers: InterviewSetupHandlers,
  getProvider: () => IProblemProvider
): void {
  interviewSetupOnStart = handlers.onStart;
  interviewSetupOnOpenProblem = handlers.onOpenProblem;
  interviewSetupGetProvider = getProvider;
  interviewHubExtensionContext = context;
  const panel = ensureInterviewSetupPanel(context);
  const session = getInterviewSession(context.globalState);
  panel.title = session?.active ? "LeetCode — Interview" : "LeetCode — Interview setup";
  panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One);
  void renderInterviewSetupHtml(context, getProvider).then((html) => {
    panel.webview.html = html;
  });
}

export async function openInterviewReportWebview(
  context: vscode.ExtensionContext,
  model: InterviewReportViewModel,
  getProvider?: () => IProblemProvider
): Promise<void> {
  interviewReportLastModel = model;
  interviewReportGetProvider = getProvider ?? null;
  const iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
  const html = await renderInterviewReportHtml(context, model);
  const title = `LeetCode — ${model.interviewName}`;
  if (interviewReportPanel) {
    try {
      interviewReportPanel.title = title;
      interviewReportPanel.reveal(interviewReportPanel.viewColumn ?? vscode.ViewColumn.One);
      interviewReportPanel.webview.html = html;
      return;
    } catch {
      interviewReportPanel = null;
    }
  }
  const panel = vscode.window.createWebviewPanel(
    "leetcodeInterviewReport",
    title,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, iconPath } as vscode.WebviewPanelOptions
  );
  interviewReportPanel = panel;
  panel.webview.onDidReceiveMessage((msg: { type?: string; titleSlug?: string }) => {
    if (msg?.type !== "openAttemptSolution" || typeof msg.titleSlug !== "string") return;
    const gp = interviewReportGetProvider;
    const m = interviewReportLastModel;
    if (!gp || !m) return;
    void openInterviewAttemptSolutionFile(context, gp, m, msg.titleSlug);
  });
  panel.onDidDispose(() => {
    if (interviewReportPanel === panel) {
      interviewReportPanel = null;
    }
  });
  panel.webview.html = html;
}

/** Runs the solution file in the integrated terminal (strategy: tsx / node / python3 / g++). */
export function runTsNodeInTerminal(filePath: string): void {
  const ext = path.extname(filePath);
  const strategy = languageStrategyFromExtension(ext);
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal("LeetCode");
  terminal.show();
  terminal.sendText(
    (strategy ?? getLanguageStrategy("typescript")).buildTerminalCommand(filePath)
  );
}

async function renderTestcasesHtml(
  context: vscode.ExtensionContext,
  opts: {
    status: boolean;
    heading: string;
    subheading: string;
    compileMessage?: string;
    testcaseResults?: Array<{
      id: number;
      status: boolean;
      stdin?: string;
      stdout?: string;
      expectedOutput?: string;
    }>;
  }
): Promise<string> {
  const templatesDir = getTemplatesDir(context);
  if (opts.compileMessage) {
    return ejs.renderFile(path.join(templatesDir, "compilation.ejs"), {
      compileMessage: opts.compileMessage,
    });
  }
  return ejs.renderFile(path.join(templatesDir, "run.ejs"), {
    status: opts.status,
    heading: opts.heading,
    subheading: opts.subheading,
    testcaseResults: opts.testcaseResults ?? [],
  });
}

/** Fetches fresh problem data, updates cache and webview html. No user-facing error. */
async function softReload(
  context: vscode.ExtensionContext,
  titleSlug: string,
  getProvider: () => IProblemProvider,
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined
): Promise<void> {
  const problem = await getProvider().getProblem(titleSlug);
  if (!problem) return;
  setCachedProblem(titleSlug, problem, context);
  const state = problemViews.get(titleSlug);
  if (state?.webviewPanel) {
    const status = getProblemStatus?.(titleSlug);
    const isLoggedIn = Database.isLoggedIn(context);
    state.problem = problem;
    state.webviewPanel.webview.html = await renderChallengeHtml(
      context,
      problem,
      status,
      isLoggedIn,
      state.webviewPanel.webview
    );
  }
  firePlainProblemDocumentChanged(titleSlug);
}

interface SetupPanelMessageHandlerOpts {
  getProvider?: () => IProblemProvider;
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined;
  onMarkSolved?: (titleSlug: string) => void | Promise<void>;
  onMarkInterviewSolved?: (titleSlug: string) => void | Promise<void>;
}

function setupPanelMessageHandler(
  context: vscode.ExtensionContext,
  titleSlug: string,
  opts?: SetupPanelMessageHandlerOpts
): void {
  const state = problemViews.get(titleSlug);
  if (!state) return;
  state.webviewPanel.webview.onDidReceiveMessage(
    async (msg: {
      event: string;
      titleSlug: string;
      customInput?: string;
      note?: string;
      language?: string;
    }) => {
      const { event, titleSlug: msgSlug, customInput, note, language: msgLanguage } = msg;
      const s = problemViews.get(msgSlug);
      if (!s) return;
      const timer = getProblemTimer();
      if (event === "timerReady" && timer) {
        timer.sendInitialState(msgSlug);
      } else if (event === "timerRestart" && timer) {
        timer.handleRestart(msgSlug);
      } else if (event === "timerPause" && timer) {
        timer.handlePause(msgSlug);
      } else if (event === "timerResume" && timer) {
        timer.handleResume(msgSlug);
      } else if (event === "solve") {
        const lang =
          msgLanguage && isSupportedLanguage(String(msgLanguage))
            ? (String(msgLanguage) as SupportedLanguage)
            : getEffectiveChallengePanelLanguage(context);
        await openOrCreateSolution(context, s.problem, lang);
      } else if (event === "solveAsLang") {
        if (!msgLanguage || !isSupportedLanguage(String(msgLanguage))) return;
        await openOrCreateSolution(
          context,
          s.problem,
          String(msgLanguage) as SupportedLanguage
        );
      } else if (event === "setChallengeLanguage") {
        if (msgLanguage && isSupportedLanguage(String(msgLanguage))) {
          await context.globalState.update(
            LAST_CHALLENGE_PANEL_LANGUAGE_KEY,
            String(msgLanguage) as SupportedLanguage
          );
        }
      } else if (event === "run") {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const lang = getEffectiveChallengePanelLanguage(context);
        trackAnalytics("run_in_terminal", "webview", "run_in_terminal", {
          language: bucketLanguage(lang),
        });
        const { path: filePath } = await Database.resolveSolutionFilePathForOpen(
          uri,
          s.problem.id,
          s.problem.titleSlug,
          interviewSolutionBaseDir(context.globalState),
          interviewSolutionAttemptHex(context.globalState),
          lang
        );
        runTsNodeInTerminal(filePath);
      } else if (event === "runOnLeetCode" && customInput !== undefined) {
        await executeCode(context, s.problem, "run", customInput);
      } else if (event === "submit") {
        await executeCode(context, s.problem, "submit");
      } else if (event === "markAsSolved") {
        trackAnalytics("command_invoked", "webview", "mark_solved", {
          difficulty: bucketDifficulty(s.problem.difficulty),
        });
        getProblemTimer()?.handlePause(msgSlug);
        if (opts?.onMarkSolved) {
          await Promise.resolve(opts.onMarkSolved(msgSlug));
        } else {
          setProblemStatus(context.globalState, msgSlug, "solved");
        }
        if (opts?.getProvider && opts?.getProblemStatus) {
          await softReload(context, msgSlug, opts.getProvider, opts.getProblemStatus);
        }
      } else if (event === "markInterviewSolved") {
        trackAnalytics("command_invoked", "webview", "mark_interview_solved", {
          difficulty: bucketDifficulty(s.problem.difficulty),
        });
        if (opts?.onMarkInterviewSolved) {
          await Promise.resolve(opts.onMarkInterviewSolved(msgSlug));
        }
        if (opts?.getProvider && opts?.getProblemStatus) {
          await softReload(context, msgSlug, opts.getProvider, opts.getProblemStatus);
        }
      } else if (event === "saveNote" && msgSlug && note !== undefined) {
        trackAnalytics("command_invoked", "webview", "save_note");
        const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
        await context.globalState.update("leetcode-practice.problemNotes", { ...notesMap, [msgSlug]: note });
      } else if (event === "toggleFocusMode") {
        const inWorkbenchFocus =
          context.workspaceState.get(FOCUS_ZEN_STATUSBAR_PREV_KEY) !== undefined;
        if (inWorkbenchFocus) {
          await vscode.commands.executeCommand("leetcode-practice.focusModeExit");
        } else {
          await vscode.commands.executeCommand("leetcode-practice.focusModeEnter", { silent: true });
        }
      } else if (event === "agentHint") {
        await vscode.commands.executeCommand("leetcode-practice.agentHint", { titleSlug: msgSlug });
      } else if (event === "agentAnalyze") {
        await vscode.commands.executeCommand("leetcode-practice.agentAnalyze", { titleSlug: msgSlug });
      } else if (event === "openHintAnalysis") {
        await vscode.commands.executeCommand("leetcode-practice.openHintAnalysis", { titleSlug: msgSlug });
      }
    }
  );
}

export interface OpenProblemWebviewOpts {
  onMarkSolved?: (titleSlug: string) => void | Promise<void>;
  onMarkInterviewSolved?: (titleSlug: string) => void | Promise<void>;
}

function interviewProblemViewColumn(context: vscode.ExtensionContext): vscode.ViewColumn {
  return getInterviewSession(context.globalState)?.active ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
}

export async function openProblemWebview(
  context: vscode.ExtensionContext,
  item: ProblemListItem,
  getProvider: () => IProblemProvider,
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined,
  opts?: OpenProblemWebviewOpts
): Promise<void> {
  trackAnalytics("problem_opened", "webview", "open_problem", {
    difficulty: bucketDifficulty(item.difficulty),
  });
  const col = interviewProblemViewColumn(context);
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (getEffectiveConfig(folders).problemViewMode === "text") {
    const existingPanel = problemViews.get(item.titleSlug);
    if (existingPanel) {
      existingPanel.webviewPanel.dispose();
    }
    await openProblemAsPlainText(context, item, getProvider, col);
    void setInterviewFocusProblem(context.globalState, item.titleSlug);
    return;
  }
  const existing = problemViews.get(item.titleSlug);
  if (existing) {
    existing.webviewPanel.reveal(col);
    void setInterviewFocusProblem(context.globalState, item.titleSlug);
    softReload(context, item.titleSlug, getProvider, getProblemStatus).catch(
      () => {}
    );
    return;
  }

  await ensureProblemCacheLoaded(context);
  const cached = getCachedProblem(item.titleSlug);
  if (cached) {
    const status = getProblemStatus?.(cached.titleSlug);
    const isLoggedIn = Database.isLoggedIn(context);
    const panel = vscode.window.createWebviewPanel(
      PROBLEM_WEBVIEW_VIEWTYPE,
      item.title,
      col,
      getProblemWebviewOptions(context)
    );
    panel.iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
    panel.webview.html = await renderChallengeHtml(
      context,
      cached,
      status,
      isLoggedIn,
      panel.webview
    );
    problemViews.set(item.titleSlug, { webviewPanel: panel, problem: cached });
    panel.onDidDispose(() => {
      getProblemTimer()?.unregisterPanel(item.titleSlug);
      const s = problemViews.get(item.titleSlug);
      s?.testcasesPanel?.dispose();
      problemViews.delete(item.titleSlug);
    });
    setupPanelMessageHandler(context, item.titleSlug, {
      getProvider,
      getProblemStatus,
      onMarkSolved: opts?.onMarkSolved,
      onMarkInterviewSolved: opts?.onMarkInterviewSolved,
    });
    getProblemTimer()?.registerPanel(item.titleSlug, panel, cached.title, status === "solved", cached.difficulty);
    void setInterviewFocusProblem(context.globalState, item.titleSlug);
    softReload(context, item.titleSlug, getProvider, getProblemStatus).catch(
      () => {}
    );
    return;
  }

  const problem = await getProvider().getProblem(item.titleSlug);
  if (!problem) {
    vscode.window.showErrorMessage("Could not load problem.");
    return;
  }
  setCachedProblem(item.titleSlug, problem, context);
  const status = getProblemStatus?.(problem.titleSlug);
  const isLoggedIn = Database.isLoggedIn(context);
  const panel = vscode.window.createWebviewPanel(
    PROBLEM_WEBVIEW_VIEWTYPE,
    item.title,
    col,
    getProblemWebviewOptions(context)
  );
  panel.iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
  panel.webview.html = await renderChallengeHtml(
    context,
    problem,
    status,
    isLoggedIn,
    panel.webview
  );
  problemViews.set(item.titleSlug, { webviewPanel: panel, problem });
  panel.onDidDispose(() => {
    getProblemTimer()?.unregisterPanel(item.titleSlug);
    const s = problemViews.get(item.titleSlug);
    s?.testcasesPanel?.dispose();
    problemViews.delete(item.titleSlug);
  });
  setupPanelMessageHandler(context, item.titleSlug, {
    getProvider,
    getProblemStatus,
    onMarkSolved: opts?.onMarkSolved,
    onMarkInterviewSolved: opts?.onMarkInterviewSolved,
  });
  getProblemTimer()?.registerPanel(item.titleSlug, panel, problem.title, status === "solved", problem.difficulty);
  void setInterviewFocusProblem(context.globalState, item.titleSlug);
}

export interface ProblemPanelState {
  titleSlug?: string;
}

/** Restores a problem webview panel after window reload. Used by WebviewPanelSerializer. */
export async function restoreProblemPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  state: ProblemPanelState | undefined,
  getProvider: () => IProblemProvider,
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined,
  opts?: OpenProblemWebviewOpts
): Promise<void> {
  const titleSlug = state?.titleSlug;
  if (!titleSlug) {
    panel.webview.html = "<p>Unable to restore: no problem state.</p>";
    return;
  }
  panel.webview.html = RESTORE_LOADING_HTML;
  try {
    await ensureProblemCacheLoaded(context);
    let problem = getCachedProblem(titleSlug);
    if (!problem) {
      const fetched = await fetchProblemForRestore(getProvider, titleSlug);
      if (fetched === undefined) {
        panel.webview.html = `<p>Timed out loading this problem (${RESTORE_FETCH_TIMEOUT_MS / 1000}s). Check the network, then close this tab and reopen the problem from the sidebar.</p>`;
        Logger.logError("restoreProblemPanel: fetch timeout", new Error(titleSlug));
        return;
      }
      problem = fetched ?? undefined;
      if (problem) setCachedProblem(titleSlug, problem, context);
    }
    if (!problem) {
      panel.webview.html = "<p>Could not load problem. Try opening from the list again.</p>";
      return;
    }
    panel.iconPath = { light: LOGO_URI(context), dark: LOGO_URI(context) };
    panel.title = problem.title;
    const status = getProblemStatus?.(titleSlug);
    const isLoggedIn = Database.isLoggedIn(context);
    panel.webview.html = await renderChallengeHtml(
      context,
      problem,
      status,
      isLoggedIn,
      panel.webview
    );
    problemViews.set(titleSlug, { webviewPanel: panel, problem });
    panel.onDidDispose(() => {
      getProblemTimer()?.unregisterPanel(titleSlug);
      const s = problemViews.get(titleSlug);
      s?.testcasesPanel?.dispose();
      problemViews.delete(titleSlug);
    });
    setupPanelMessageHandler(context, titleSlug, {
      getProvider,
      getProblemStatus,
      onMarkSolved: opts?.onMarkSolved,
      onMarkInterviewSolved: opts?.onMarkInterviewSolved,
    });
    getProblemTimer()?.registerPanel(titleSlug, panel, problem.title, status === "solved", problem.difficulty);
    void setInterviewFocusProblem(context.globalState, titleSlug);
  } catch (e) {
    Logger.logError("restoreProblemPanel failed", e);
    panel.webview.html = `<p>Could not restore this problem view. Close the tab and open the problem again from the LeetCode sidebar.</p><p>${e instanceof Error ? e.message : String(e)}</p>`;
  }
}

export async function openOrCreateSolution(
  context: vscode.ExtensionContext,
  problem: Problem,
  language?: SupportedLanguage
): Promise<void> {
  const lang = language ?? getEffectiveChallengePanelLanguage(context);
  if (workspaceHasLeetcodeMarker()) {
    const practice = vscode.workspace.getConfiguration("leetcodePractice");
    const suppress = practice.get<boolean>("suppressAiTabOnSolve") ?? true;
    if (suppress) {
      const workspaceWide = practice.get<boolean>("suppressAiTabWorkspaceWide") ?? false;
      try {
        if (workspaceWide) {
          await suppressInlineSuggestWorkspaceWide();
        } else {
          await suppressTabLikeFeaturesForPracticeLanguage(lang);
        }
      } catch {
        /* settings update can fail in restricted workspaces */
      }
    }
  }
  const uri = vscode.window.activeTextEditor?.document.uri;
  const { path: filePath, exists } = await Database.resolveSolutionFilePathForOpen(
    uri,
    problem.id,
    problem.titleSlug,
    interviewSolutionBaseDir(context.globalState),
    interviewSolutionAttemptHex(context.globalState),
    lang
  );
  if (!exists) {
    const content = generateTemplate(problem, { language: lang });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, "utf8"));
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false,
  });
}

async function executeCode(
  context: vscode.ExtensionContext,
  problem: Problem,
  action: "run" | "submit",
  customInput?: string
): Promise<void> {
  const session = Database.getSession(context);
  if (!session?.cookie?.trim()) {
    vscode.window.showErrorMessage(
      "Sign in first (LeetCode: Sign In) to run or submit on LeetCode."
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const fileName = editor?.document.fileName ?? "";
  const ext = path.extname(fileName);
  const strategy = languageStrategyFromExtension(ext);
  if (!editor || !strategy) {
    vscode.window.showWarningMessage(
      "Open a solution file (.ts, .js, .py, .cpp, or .java) and try again."
    );
    return;
  }
  const langSlug = leetcodeApiLangFor(strategy.id);
  const code = editor.document.getText();
  const leetcode = new LeetCodeProvider();
  const state = problemViews.get(problem.titleSlug);
  vscode.window.showInformationMessage(action === "run" ? "Running..." : "Submitting...");

  if (action === "run") {
    const runResult = await leetcode.runCode(
      problem.titleSlug,
      code,
      langSlug,
      session.cookie,
      customInput
    );
    if (!runResult) {
      Logger.log("Run failed: runCode returned null (see lines above for HTTP/API details)");
      vscode.window.showErrorMessage("Run failed. Check cookie or network. See Output → LeetCode Practice for details.");
      return;
    }
    const status = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Running on LeetCode..." },
      () =>
        pollRunStatus(() =>
          leetcode.getRunStatus(runResult.interpretId, session.cookie)
        )
    );
    if (!status) {
      vscode.window.showErrorMessage("Run timed out.");
      return;
    }
    const success = !status.compileError && status.status === 10;
    const heading = status.compileError
      ? "Compilation Error :("
      : success
        ? "Congratulations! :)"
        : "Wrong answer :(";
    const subheading = status.compileError
      ? "Check the compiler output, fix the error and try again."
      : success
        ? "You have passed the sample testcases. Click the submit button to run your code against all the code test cases."
        : "Check the compiler error, fix the error and try again.";
    const html = status.compileError
      ? await renderTestcasesHtml(context, {
          status: false,
          heading: "Compilation Error :(",
          subheading,
          compileMessage: status.compileError,
        })
      : await renderTestcasesHtml(context, {
          status: success,
          heading,
          subheading,
          testcaseResults: [
            {
              id: 0,
              status: success,
              stdin: problem.sampleTestCase || "",
              stdout: status.runOutput,
              expectedOutput: undefined,
            },
          ],
        });
    if (state?.testcasesPanel) {
      state.testcasesPanel.reveal(vscode.ViewColumn.Three);
      state.testcasesPanel.webview.html = html;
    } else {
      const panel = vscode.window.createWebviewPanel(
        "testcases",
        "Testcases",
        { viewColumn: vscode.ViewColumn.Three, preserveFocus: true },
        {}
      );
      panel.webview.html = html;
      if (state) state.testcasesPanel = panel;
      panel.onDidDispose(() => {
        if (state) state.testcasesPanel = undefined;
      });
    }
  } else {
    const submitResult = await leetcode.submitCode(
      problem.titleSlug,
      code,
      langSlug,
      session.cookie
    );
    if (!submitResult) {
      Logger.log("Submit failed: submitCode returned null (see lines above for HTTP/API details)");
      vscode.window.showErrorMessage("Submit failed. Check cookie or network. See Output → LeetCode Practice for details.");
      return;
    }
    const status = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Submitting to LeetCode..." },
      () =>
        pollSubmitStatus(() =>
          leetcode.getSubmitStatus(submitResult.submissionId, session.cookie)
        )
    );
    if (!status) {
      vscode.window.showErrorMessage("Submit timed out.");
      return;
    }
    const success = status.runSuccess === true;
    const heading = success
      ? "Accepted"
      : status.compileError
        ? "Compilation Error :("
        : status.status;
    const subheading = success
      ? "You have passed all test cases."
      : status.compileError
        ? "Check the compiler output, fix the error and try again."
        : "Fix the error and try again.";
    const html = status.compileError
      ? await renderTestcasesHtml(context, {
          status: false,
          heading: "Compilation Error :(",
          subheading,
          compileMessage: status.compileError,
        })
      : await renderTestcasesHtml(context, {
          status: success,
          heading,
          subheading,
          testcaseResults: [
            {
              id: 0,
              status: success,
              stdout: status.runtimeError ?? status.status,
              expectedOutput: "—",
            },
          ],
        });
    if (state?.testcasesPanel) {
      state.testcasesPanel.reveal(vscode.ViewColumn.Three);
      state.testcasesPanel.webview.html = html;
    } else {
      const panel = vscode.window.createWebviewPanel(
        "testcases",
        "Testcases",
        { viewColumn: vscode.ViewColumn.Three, preserveFocus: true },
        {}
      );
      panel.webview.html = html;
      if (state) state.testcasesPanel = panel;
      panel.onDidDispose(() => {
        if (state) state.testcasesPanel = undefined;
      });
    }
  }
}
