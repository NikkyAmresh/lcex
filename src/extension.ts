import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { IProblemProvider } from "./modules/interface/Problem";
import { LeetCodeProvider, type DailyChallengeEntry, type ProblemListItem } from "./modules/LeetCode";
import { InternalApiProvider } from "./modules/InternalProvider";
import * as Authentication from "./modules/Authentication";
import * as Database from "./modules/Database";
import {
  ProblemsTreeProvider,
  ProblemTreeItem,
  setProblemStatus,
  getStoredStatus,
  getAllStatusEntries,
} from "./modules/ProblemsProvider";
import {
  ContestsTreeProvider,
  ContestProblemTreeItem,
  PastContestItem,
  UpcomingContestItem,
} from "./modules/ContestsProvider";
import { openContestSetupWebview } from "./modules/ContestSetupView";
import {
  CompaniesTreeProvider,
  CompanyProblemTreeItem,
} from "./modules/CompaniesProvider";
import { PatternMasteryTreeProvider } from "./modules/PatternMasteryProvider";
import {
  pickWeakestPattern,
  recordSolveForPatterns,
  summarizePatternMastery,
} from "./modules/PatternMastery";
import { detectPatterns, getPatternMeta, type PatternId } from "./modules/PatternDetector";
import { openPatternDrillWebview } from "./modules/PatternDrillView";
import type { OpenProblemWebviewOpts, ProblemPanelState } from "./modules/ProblemView";
import {
  openProblemWebview,
  openStatsWebview,
  openInterviewSetupWebview,
  refreshInterviewHubIfOpen,
  openInterviewReportWebview,
  buildInterviewReportViewModel,
  interviewReportViewModelFromSnapshotFile,
  refreshStatsData,
  runTsNodeInTerminal,
  PROBLEM_WEBVIEW_VIEWTYPE,
  registerProblemPlainTextDocumentProvider,
  restoreProblemPanel,
  getTitleSlugForActiveSolutionFile,
  notifyAllProblemPanelsUiMode,
  getCachedProblemDifficulty,
  getCachedProblemId,
  openHintFileForProblem,
  tryOpenExistingHintFile,
  openOrCreateSolution,
  plainProblemSlugFromUri,
  getCachedProblem as getProblemFromViewCache,
} from "./modules/ProblemView";
import { HintEditorProvider } from "./modules/HintEditorProvider";
import { runExamples as runExamplesImpl, parseExampleBlocks, type ExampleResult } from "./modules/ExampleRunner";
import { runFuzz } from "./modules/Fuzzer";
import { runEmpiricalFit, type ComplexityClass } from "./modules/EmpiricalFit";
import { renderRecursionTreeHtml, runRecursionTrace } from "./modules/RecursionVisualizer";
import { renderIterativeTreeHtml, runIterativeTrace } from "./modules/IterativeVisualizer";
import {
  advanceOnPass as advanceBugReviewOnPass,
  countDueReviews,
  getReviewById as getBugReviewById,
  lapseOnFail as lapseBugReviewOnFail,
  listDueReviews,
  recordFailure as recordBugReviewFailure,
  type BugReview,
} from "./modules/BugReviewStore";
import {
  SOLUTION_FILE_EXTENSIONS,
  languageFromFileExtension,
} from "./modules/language/LanguageStrategy";
import {
  applyInlineDecorations,
  clearInlineDecorations,
  clearAllInlineDecorations,
  disposeInlineDecorationTypes,
  type InlineItem,
} from "./modules/InlineDecorations";
import {
  buildAdversarialSummary,
  findSignatureLine,
} from "./modules/AdversarialTests";
import {
  lintSolutionSource,
  firstFindingPerLine,
  type LintFinding,
} from "./modules/InterviewLint";
import { parseProblemConstraints } from "./modules/ConstraintParser";
import {
  deriveBudget,
  estimateLoopNesting,
  buildComplexityInlineItems,
  compareToBudget,
} from "./modules/ComplexityBudget";
import * as Logger from "./modules/Logger";
import {
  bucketCount,
  bucketDifficulty,
  bucketDurationMin,
  bucketLanguage,
  disposeAnalytics,
  flushAnalytics,
  initAnalytics,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
  track as trackAnalytics,
} from "./modules/cloud/analytics";
import {
  parseLeetcodeConfig,
  getEffectiveConfig,
  resolveDefaultStudyPlanSlug,
  resolveDefaultProblemListSlug,
} from "./modules/LeetcodeConfig";
import { LeetcodeConfigEditorProvider } from "./modules/LeetcodeConfigEditor";
import { initProblemTimer, disposeProblemTimer, TIMER_BY_DAY_KEY } from "./modules/ProblemTimer";
import {
  addBonusXp,
  awardXpForFirstSolve,
  countSolvedToday,
  getDailyGoal as readDailyGoal,
  getTotalXp,
  grantDailyLoginXpIfNeeded,
  setDailyGoal as persistDailyGoal,
  sumTimerMinutesToday,
  todayIso,
  xpLevelProgress,
  FOCUS_COMPACT_WEBVIEW_KEY,
  FOCUS_ZEN_STATUSBAR_PREV_KEY,
  FOCUS_LAST_PARTICIPATION_XP_AT_KEY,
  FOCUS_SESSION_PARTICIPATION_XP,
  FOCUS_SESSION_XP_COOLDOWN_MS,
} from "./modules/Gamification";
import {
  endInterviewSession,
  getInterviewSession,
  incrementInterviewTimeForFocusedProblem,
  pickPlannedInterviewProblems,
  recordInterviewSolve,
  remainingMs,
  startInterviewSession,
  setInterviewContext,
  type EndInterviewSessionResult,
  type PlannedInterviewProblem,
} from "./modules/InterviewMode";
import type { InterviewSetupSource, InterviewSetupStartMessage } from "./modules/ProblemView";
import { loadCompaniesDataset } from "./modules/CompaniesData";
import {
  normalizeInterviewFilePath,
  readInterviewReportFile,
  writeInterviewReportFile,
  writeInterviewReportAtPath,
  getReportPathForInterviewFile,
  getReportPathForAttempt,
} from "./modules/LcexInterviewReportStore";
import type { LcInterviewFileV1 } from "./modules/LcInterviewFile";
import { defaultInterviewNameFromDate, parseLcInterviewFile, serializeLcInterviewFile } from "./modules/LcInterviewFile";
import { LeetcodeInterviewEditorProvider } from "./modules/LcInterviewEditorProvider";
import { LcInterviewReportEditorProvider } from "./modules/LcInterviewReportEditorProvider";
import { ensureCursorLcexPluginInstalled } from "./modules/CursorLcexPluginInstall";
import { ensureLcexBundledFontsInstalled } from "./modules/LcexFontInstall";
import { applyLcexEditorFontAndTokenSettingsIfNeeded } from "./modules/LeetcodePracticeEditorSettings";
import {
  applyCloudStatsMerge,
  fetchCloudStatsDocument,
  formatPushWaitMessage,
  getConfiguredLeetcodeUsername,
  PUSH_INTERVAL_MS,
  pushStatsToCloud,
  sanitizeCloudUsername,
} from "./modules/cloud/cloudStatsSync";
import { getCloudIdentity, parseAuthCallback } from "./modules/cloud/firebaseApp";
import { handleAuthCallback, signInToCloud, signOutFromCloud } from "./modules/cloud/cloudAuth";
import { isCurrentUserOnWellnessListSync, refreshAndCheckWellnessList } from "./modules/cloud/wellness";
import { recordInstallActivity } from "./modules/cloud/installRegistry";

function getProvider(): IProblemProvider {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getEffectiveConfig(folders);
  if (config.internalApiUrl?.trim()) {
    return new InternalApiProvider(config.internalApiUrl.trim());
  }
  return new LeetCodeProvider();
}

const LEETCODE_MARKER = ".leetcode";
const LEETCODE_THEME = "LeetCode Dark";

function hasLeetcodeMarker(workspaceFolder: vscode.WorkspaceFolder): boolean {
  const markerPath = path.join(workspaceFolder.uri.fsPath, LEETCODE_MARKER);
  return fs.existsSync(markerPath);
}

function computeHasLeetcodeMarker(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return false;
  return folders.some(hasLeetcodeMarker);
}

let hasMarkerCache = false;
let hasMarkerCacheInitialized = false;

function shouldAutoApplyTheme(): boolean {
  if (!hasMarkerCacheInitialized) {
    hasMarkerCache = computeHasLeetcodeMarker();
    hasMarkerCacheInitialized = true;
  }
  return hasMarkerCache;
}

const HAS_MARKER_CONTEXT = "leetcodePractice.hasMarker";
const SHOW_PROBLEMSET_CONTEXT = "leetcodePractice.showProblemset";
const SHOW_STUDY_PLANS_CONTEXT = "leetcodePractice.showStudyPlans";
const SHOW_PROBLEM_LISTS_CONTEXT = "leetcodePractice.showProblemLists";
const SHOW_QOTD_CONTEXT = "leetcodePractice.showQotd";
const SHOW_CONTESTS_CONTEXT = "leetcodePractice.showContests";
const SHOW_COMPANIES_CONTEXT = "leetcodePractice.showCompanies";
const IS_SOLUTION_FILE_CONTEXT = "leetcodePractice.isSolutionFile";

const SOLUTION_EXTENSIONS = new Set(SOLUTION_FILE_EXTENSIONS);

const NUMBERED_FILE_PATTERN = /^(\d+)\.(ts|js|py|cpp|java)$/i;

/** Shows problem name as tooltip on numbered solution files in LeetCode workspaces. */
class LeetCodeFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private idToTitle = new Map<string, string>();
  private lastLoadTime = 0;
  private readonly CACHE_TTL_MS = 60_000;

  constructor(private storagePath: string) {}

  invalidate(): void {
    this.idToTitle.clear();
    this.lastLoadTime = 0;
    this._onDidChangeFileDecorations.fire(undefined);
  }

  private ensureIdToTitleMap(): void {
    const now = Date.now();
    if (this.idToTitle.size > 0 && now - this.lastLoadTime < this.CACHE_TTL_MS) return;
    this.idToTitle.clear();
    this.lastLoadTime = now;
    const addFromList = (items: Array<{ id?: string; title?: string }>) => {
      for (const it of items) {
        if (it.id && it.title) this.idToTitle.set(String(it.id), it.title);
      }
    };
    try {
      const problemsetPath = path.join(this.storagePath, "problemset-cache.json");
      if (fs.existsSync(problemsetPath)) {
        const raw = fs.readFileSync(problemsetPath, "utf-8");
        const arr = JSON.parse(raw) as Array<{ id?: string; title?: string }>;
        if (Array.isArray(arr)) addFromList(arr);
      }
      const dir = path.dirname(path.join(this.storagePath, "x"));
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const f of files) {
        const m = f.name.match(/^(.+)-cache\.json$/);
        if (m) {
          const raw = fs.readFileSync(path.join(dir, f.name), "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            for (const g of parsed) {
              const probs = (g as { problems?: Array<{ id?: string; title?: string }> }).problems;
              if (Array.isArray(probs)) addFromList(probs);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folders.find((f) => {
      const rel = path.relative(f.uri.fsPath, uri.fsPath);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (!folder || !hasLeetcodeMarker(folder)) return undefined;
    const base = path.basename(uri.fsPath);
    const m = base.match(NUMBERED_FILE_PATTERN);
    if (!m) return undefined;
    const id = m[1];
    this.ensureIdToTitleMap();
    const title = this.idToTitle.get(id);
    if (!title) return undefined;
    return new vscode.FileDecoration(undefined, title);
  }
}

let statusBarMakeRunnable: vscode.StatusBarItem | undefined;
let statusBarHint: vscode.StatusBarItem | undefined;
let statusBarAnalyze: vscode.StatusBarItem | undefined;

function isSolutionFile(uri: vscode.Uri | undefined): boolean {
  if (!uri) return false;
  return SOLUTION_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}

function updateSolutionFileContext(): void {
  const editor = vscode.window.activeTextEditor;
  const hasMarker = shouldAutoApplyTheme();
  const isSolution = hasMarker && editor !== undefined && isSolutionFile(editor.document.uri);
  void vscode.commands.executeCommand("setContext", IS_SOLUTION_FILE_CONTEXT, isSolution);
}

function updateAgentStatusBarVisibility(): void {
  const editor = vscode.window.activeTextEditor;
  const hasMarker = shouldAutoApplyTheme();
  const visible = hasMarker && editor !== undefined && isSolutionFile(editor.document.uri);
  if (statusBarMakeRunnable) {
    if (visible) {
      statusBarMakeRunnable.text = "$(play) Make Runnable";
      statusBarMakeRunnable.tooltip = "Ask agent: Make this runnable (prompt from .leetcode)";
      statusBarMakeRunnable.command = "leetcode-practice.agentMakeRunnable";
      statusBarMakeRunnable.show();
    } else {
      statusBarMakeRunnable.hide();
    }
  }
  if (statusBarHint) {
    if (visible) {
      statusBarHint.text = "$(lightbulb) Hint";
      statusBarHint.tooltip =
        "Coaching: open .hint if it exists, else ask the agent (lcex-dsa-hint). Configure in .leetcode.";
      statusBarHint.command = "leetcode-practice.agentHint";
      statusBarHint.show();
    } else {
      statusBarHint.hide();
    }
  }
  if (statusBarAnalyze) {
    if (visible) {
      statusBarAnalyze.text = "$(graph) Analyze";
      statusBarAnalyze.tooltip =
        "Scored review: open .hint if it exists, else ask the agent (lcex-dsa-analyze). Configure in .leetcode.";
      statusBarAnalyze.command = "leetcode-practice.agentAnalyze";
      statusBarAnalyze.show();
    } else {
      statusBarAnalyze.hide();
    }
  }
}

function updateHasMarkerContext(): void {
  const hasMarker = computeHasLeetcodeMarker();
  hasMarkerCache = hasMarker;
  hasMarkerCacheInitialized = true;
  void vscode.commands.executeCommand("setContext", HAS_MARKER_CONTEXT, hasMarker);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = folders.length > 0 ? getEffectiveConfig(folders) : null;
  void vscode.commands.executeCommand("setContext", SHOW_PROBLEMSET_CONTEXT, config?.showProblemset ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_STUDY_PLANS_CONTEXT, config?.showStudyPlans ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_PROBLEM_LISTS_CONTEXT, config?.showProblemLists ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_QOTD_CONTEXT, config?.showQotd ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_CONTESTS_CONTEXT, config?.showContests ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_COMPANIES_CONTEXT, config?.showCompanies ?? true);
  updateSolutionFileContext();
  updateAgentStatusBarVisibility();
  if (extensionContextForBars) {
    updateGamificationStatusBars(extensionContextForBars);
  }
  Logger.log(`Sidebar visibility: hasMarker=${hasMarker}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** URI path prefix for opening a problem by slug: /open/{slug} */
const URI_OPEN_PREFIX = "/open/";

/** Handles vscode://lcex.leetcode-practice/open/{slug}. */
function createUriHandler(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  getWebviewOpts?: () => OpenProblemWebviewOpts | undefined
): vscode.UriHandler {
  return {
    handleUri(uri: vscode.Uri): void {
      const path = uri.path ?? "";
      if (path === "/auth" || path === "/auth/") {
        const params = parseAuthCallback(uri);
        if (!params) {
          void vscode.window.showErrorMessage("Cloud sign-in callback was malformed.");
          return;
        }
        if (!handleAuthCallback(params)) {
          void vscode.window.showWarningMessage("Cloud sign-in callback ignored (no pending sign-in).");
        }
        return;
      }
      if (!path.startsWith(URI_OPEN_PREFIX)) return;
      const slug = path.slice(URI_OPEN_PREFIX.length).trim();
      if (!slug) return;
      const provider = getProvider();
      const getProblemStatus = (s: string) => getStoredStatus(context.globalState, s);
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching problem...",
        },
        async () => {
          const problem = await provider.getProblem(slug);
          if (!problem) {
            vscode.window.showErrorMessage(
              "Could not fetch problem. Check slug or network."
            );
            return;
          }
          const item = {
            id: problem.id,
            titleSlug: problem.titleSlug,
            title: problem.title,
            difficulty: problem.difficulty,
          };
          await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts?.());
        }
      );
    },
  };
}

/** Opens Cursor/IDE agent, pastes the prompt into chat, and triggers submit so the agent runs. */
async function openChatWithPrompt(prompt: string): Promise<void> {
  const withPromptCommands: Array<{ id: string; args?: unknown[] }> = [
    { id: "aichat.newchat", args: [prompt] },
    { id: "cursor.chat.new", args: [prompt] },
  ];
  for (const { id, args } of withPromptCommands) {
    try {
      await vscode.commands.executeCommand(id, ...(args ?? []));
      return;
    } catch {
      // Command may not exist or not accept args; try next
    }
  }

  // No command accepts prompt: open new agent chat, paste, then submit
  const previousClipboard = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(prompt);

  const openCommands = ["composer.newAgentChat", "aichat.newchat", "aichat.focus"];
  let opened = false;
  for (const id of openCommands) {
    try {
      await vscode.commands.executeCommand(id);
      opened = true;
      break;
    } catch {
      // try next
    }
  }
  if (!opened) {
    await vscode.env.clipboard.writeText(previousClipboard);
    vscode.window.showWarningMessage("LeetCode Practice: Could not open agent chat.");
    return;
  }

  await delay(600);

  try {
    await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
  } catch {
    // Paste may not work in chat input; restore clipboard and inform
    await vscode.env.clipboard.writeText(previousClipboard);
    vscode.window.showInformationMessage(
      "LeetCode Practice: Chat opened. Paste (Cmd+V) and press Enter to run."
    );
    return;
  }

  await delay(400);

  const submitCommands = [
    "aichat.submit",
    "cursor.chat.submit",
    "workbench.action.chat.acceptInput",
    "composer.submit",
  ];
  for (const id of submitCommands) {
    try {
      await vscode.commands.executeCommand(id);
      await vscode.env.clipboard.writeText(previousClipboard);
      return;
    } catch {
      // try next
    }
  }

  await delay(100);
  try {
    await vscode.commands.executeCommand("type", { text: "\r" });
  } catch {
    try {
      await vscode.commands.executeCommand("type", { text: "\n" });
    } catch {
      vscode.window.showInformationMessage(
        "LeetCode Practice: Prompt pasted. Press Enter to run the agent."
      );
    }
  }
  await vscode.env.clipboard.writeText(previousClipboard);
}

async function enterFocusWorkbenchLayout(): Promise<void> {
  for (const id of [
    "workbench.action.closeSidebar",
    "workbench.action.closePanel",
    "workbench.action.toggleZenMode",
    "workbench.action.toggleMaximizeEditorGroup",
  ]) {
    try {
      await vscode.commands.executeCommand(id);
    } catch {
      /* command may be unavailable */
    }
  }
}

async function enterFocusModeUi(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(FOCUS_COMPACT_WEBVIEW_KEY, true);
  notifyAllProblemPanelsUiMode(context);
  await enterFocusWorkbenchLayout();
  const cfg = vscode.workspace.getConfiguration();
  if (context.workspaceState.get(FOCUS_ZEN_STATUSBAR_PREV_KEY) === undefined) {
    const prev = cfg.get<boolean>("zenMode.hideStatusBar");
    await context.workspaceState.update(FOCUS_ZEN_STATUSBAR_PREV_KEY, prev ?? true);
  }
  await cfg.update("zenMode.hideStatusBar", false, vscode.ConfigurationTarget.Workspace);
}

async function exitFocusModeUi(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(FOCUS_COMPACT_WEBVIEW_KEY, false);
  notifyAllProblemPanelsUiMode(context);
  const prev = context.workspaceState.get<boolean | undefined>(FOCUS_ZEN_STATUSBAR_PREV_KEY);
  if (prev !== undefined) {
    await vscode.workspace
      .getConfiguration()
      .update("zenMode.hideStatusBar", prev, vscode.ConfigurationTarget.Workspace);
    await context.workspaceState.update(FOCUS_ZEN_STATUSBAR_PREV_KEY, undefined);
  }
  for (const id of [
    "workbench.action.toggleMaximizeEditorGroup",
    "workbench.action.toggleZenMode",
    "workbench.action.togglePanel",
    "workbench.action.toggleSidebarVisibility",
  ]) {
    try {
      await vscode.commands.executeCommand(id);
    } catch {
      /* */
    }
  }
  await grantFocusParticipationXpIfEligible(context);
  updateGamificationStatusBars(context);
}

async function grantFocusParticipationXpIfEligible(context: vscode.ExtensionContext): Promise<void> {
  const gs = context.globalState;
  const last = gs.get<number>(FOCUS_LAST_PARTICIPATION_XP_AT_KEY);
  const now = Date.now();
  if (typeof last === "number" && now - last < FOCUS_SESSION_XP_COOLDOWN_MS) {
    return;
  }
  await addBonusXp(gs, FOCUS_SESSION_PARTICIPATION_XP);
  await gs.update(FOCUS_LAST_PARTICIPATION_XP_AT_KEY, now);
}

async function showInterviewSessionEnded(
  context: vscode.ExtensionContext,
  result: EndInterviewSessionResult | null
): Promise<void> {
  if (!result) {
    return;
  }
  const { entry, sourceLcInterviewPath, interviewName, attemptHex, solutionFolderPath } = result;
  const plannedCount = entry.plannedCount ?? 0;
  const solvedCount = entry.solvedCount ?? 0;
  trackAnalytics("interview_ended", "auto", "interview_stop", {
    durationBucket: bucketDurationMin(entry.durationMinutes ?? 0),
    countBucket: bucketCount(plannedCount),
    result: solvedCount === plannedCount && plannedCount > 0 ? "ok" : "err",
  });
  const model = await buildInterviewReportViewModel(context, getProvider, entry, interviewName, {
    attemptId: attemptHex,
    solutionFolderPath,
  });
  await openInterviewReportWebview(context, model, getProvider);
  const hubRowsPayload = model.hubRows.map((r) => {
    const stat = entry.perProblem?.find((p) => p.titleSlug === r.titleSlug);
    return {
      titleSlug: r.titleSlug,
      title: r.title,
      practiceLabel: r.practiceLabel,
      interviewSolved: r.interviewSolved,
      secondsSpent: stat?.secondsSpent ?? 0,
      interviewXpEarned: stat?.interviewXpEarned ?? 0,
    };
  });
  if (attemptHex && solutionFolderPath) {
    const abs = sourceLcInterviewPath ? normalizeInterviewFilePath(sourceLcInterviewPath) : "";
    const reportFile = getReportPathForAttempt(solutionFolderPath, attemptHex);
    writeInterviewReportAtPath(reportFile, {
      version: 1,
      interviewName,
      sourceLcInterviewPath: abs,
      writtenAt: Date.now(),
      entry,
      attemptId: attemptHex,
      solutionFolderPath,
      hubRows: hubRowsPayload,
    });
  } else if (sourceLcInterviewPath) {
    const abs = normalizeInterviewFilePath(sourceLcInterviewPath);
    writeInterviewReportFile({
      version: 1,
      interviewName,
      sourceLcInterviewPath: abs,
      writtenAt: Date.now(),
      entry,
      hubRows: hubRowsPayload,
    });
  }
  const msg =
    entry.bonusXp > 0 ? `Interview ended · +${entry.bonusXp} bonus XP` : `Interview ended`;
  void vscode.window.showInformationMessage(msg);
}

type PlannedProblemsResult =
  | { ok: true; planned: PlannedInterviewProblem[]; tags?: string[] }
  | { ok: false; message: string };

async function plannedProblemsFromSetup(
  context: vscode.ExtensionContext,
  msg: { problemCount: number; source: InterviewSetupSource }
): Promise<PlannedProblemsResult> {
  const gs = context.globalState;
  const n = Math.min(50, Math.max(1, Math.floor(msg.problemCount)));
  const isSolved = (slug: string) => getStoredStatus(gs, slug) === "solved";
  const source = msg.source;

  if (source.kind === "custom") {
    const custom = source.slugsRaw.trim();
    const slugs = [...new Set(custom.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
    if (slugs.length === 0) {
      return { ok: false, message: "Enter at least one valid slug." };
    }
    const planned: PlannedInterviewProblem[] = [];
    const provider = getProvider();
    for (const slug of slugs) {
      const prob = await provider.getProblem(slug);
      if (prob) {
        planned.push({
          titleSlug: prob.titleSlug,
          difficulty: (prob.difficulty || "MEDIUM").toUpperCase(),
        });
      }
    }
    if (planned.length === 0) {
      return { ok: false, message: "Could not resolve any of those slugs." };
    }
    return { ok: true, planned };
  }

  if (source.kind === "company") {
    const company = source.company.trim();
    if (!company) {
      return { ok: false, message: "Pick a company." };
    }
    const dataset = loadCompaniesDataset(context.extensionPath);
    if (!dataset) {
      return { ok: false, message: "Companies dataset is not available." };
    }
    const edges = dataset.companies[company] ?? [];
    if (edges.length === 0) {
      return { ok: false, message: `No problems found for ${company}.` };
    }
    const sortedEdges = [...edges].sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0));
    const list = sortedEdges
      .map((edge) => {
        const p = dataset.problems[edge.i];
        if (!p) return null;
        return {
          titleSlug: p.slug,
          difficulty: (p.difficulty || "MEDIUM").toUpperCase(),
        };
      })
      .filter((x): x is { titleSlug: string; difficulty: string } => x !== null);
    if (list.length === 0) {
      return { ok: false, message: `No problems found for ${company}.` };
    }
    const picks = pickPlannedInterviewProblems(list, n, isSolved);
    if (picks.length === 0) {
      return { ok: false, message: "Could not pick any problems." };
    }
    return {
      ok: true,
      planned: picks,
      tags: [`company:${company.toLowerCase()}`],
    };
  }

  if (source.kind === "list") {
    const slug = source.listSlug.trim();
    if (!slug) {
      return { ok: false, message: "Enter a LeetCode list slug." };
    }
    const lc = getProvider();
    if (!(lc instanceof LeetCodeProvider)) {
      return {
        ok: false,
        message: "By-list mode needs the default LeetCode source (leave internalApiUrl empty).",
      };
    }
    const cookie = context.globalState.get<string>("leetcodeSession") ?? undefined;
    const items = await lc.getFavoriteProblemList(slug, cookie);
    if (!items.length) {
      return { ok: false, message: `LeetCode list "${slug}" had no problems or could not load.` };
    }
    const picks = pickPlannedInterviewProblems(
      items.map((q) => ({ titleSlug: q.titleSlug, difficulty: q.difficulty })),
      n,
      isSolved
    );
    if (picks.length === 0) {
      return { ok: false, message: "Could not pick any problems." };
    }
    return { ok: true, planned: picks, tags: [`list:${slug.toLowerCase()}`] };
  }

  if (source.kind === "plan") {
    const slug = source.planSlug.trim();
    if (!slug) {
      return { ok: false, message: "Pick a study plan." };
    }
    const lc = getProvider();
    if (!(lc instanceof LeetCodeProvider)) {
      return {
        ok: false,
        message: "By-plan mode needs the default LeetCode source (leave internalApiUrl empty).",
      };
    }
    const items = await lc.getStudyPlanProblemList(slug);
    if (!items.length) {
      return { ok: false, message: `Study plan "${slug}" had no problems or could not load.` };
    }
    const picks = pickPlannedInterviewProblems(
      items.map((q) => ({ titleSlug: q.titleSlug, difficulty: q.difficulty })),
      n,
      isSolved
    );
    if (picks.length === 0) {
      return { ok: false, message: "Could not pick any problems." };
    }
    return { ok: true, planned: picks, tags: [`plan:${slug.toLowerCase()}`] };
  }

  // Default: random from the full problemset.
  const lc = getProvider();
  if (!(lc instanceof LeetCodeProvider)) {
    return {
      ok: false,
      message: "Random interview mix needs the default LeetCode source (leave internalApiUrl empty).",
    };
  }

  const list = await lc.getFullProblemsetList();
  if (!list.length) {
    return { ok: false, message: "Could not load the problem list. Check your network." };
  }
  const picks = pickPlannedInterviewProblems(
    list.map((q) => ({ titleSlug: q.titleSlug, difficulty: q.difficulty })),
    n,
    isSolved
  );
  if (picks.length === 0) {
    return { ok: false, message: "Could not pick any problems." };
  }
  return { ok: true, planned: picks };
}

type InterviewPanelOpts = OpenProblemWebviewOpts | undefined;

function sanitizeInterviewDirectoryName(name: string): string {
  const t = name.trim() || "interview";
  const safe = t.replace(/[/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return safe.length > 0 ? safe : "interview";
}

function generateUniqueAttemptHex(existing: { id: string }[], solutionFolderPath: string): string {
  const used = new Set(
    existing
      .map((e) => String(e.id || "").trim().toLowerCase())
      .filter((id) => /^[0-9a-f]{3}$/.test(id))
  );
  for (let n = 0; n < 512; n++) {
    const v = crypto.randomBytes(2).readUInt16BE(0) % 4096;
    const id = v.toString(16).padStart(3, "0");
    if (used.has(id)) continue;
    const reportPath = path.join(solutionFolderPath, `report-${id}.lcireport`);
    if (fs.existsSync(reportPath)) continue;
    return id;
  }
  throw new Error("Could not allocate a unique attempt id");
}

async function runInterviewSessionAfterPlan(
  context: vscode.ExtensionContext,
  getWebviewOpts: () => InterviewPanelOpts,
  opts: {
    durationMinutes: number;
    planned: PlannedInterviewProblem[];
    sourceLcInterviewPath?: string;
    interviewName: string;
    solutionFolderPath?: string;
    attemptHex?: string;
    kind?: "contest";
    tags?: string[];
    /** When set, this problem is opened first instead of planned[0]. Must be in planned. */
    firstProblemSlug?: string;
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!shouldAutoApplyTheme()) {
    return {
      ok: false,
      message: "LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.",
    };
  }
  if (getInterviewSession(context.globalState)) {
    return { ok: false, message: "An interview session is already active." };
  }
  if (!opts.planned.length) {
    return { ok: false, message: "No problems in plan." };
  }
  await startInterviewSession(context.globalState, opts.durationMinutes, opts.planned, {
    sourceLcInterviewPath: opts.sourceLcInterviewPath,
    interviewName: opts.interviewName,
    ...(opts.solutionFolderPath ? { solutionFolderPath: opts.solutionFolderPath } : {}),
    ...(opts.attemptHex ? { attemptHex: opts.attemptHex } : {}),
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
  });
  trackAnalytics("interview_started", "auto", "interview_start", {
    durationBucket: bucketDurationMin(opts.durationMinutes),
    countBucket: bucketCount(opts.planned.length),
    source: opts.kind === "contest" ? "panel" : opts.sourceLcInterviewPath ? "ai" : "panel",
  });
  await setInterviewContext(true);
  await enterFocusModeUi(context);
  notifyAllProblemPanelsUiMode(context);
  startInterviewTick(context);
  refreshInterviewStatusBarNow(context);
  updateGamificationStatusBars(context);

  const first =
    (opts.firstProblemSlug && opts.planned.find((p) => p.titleSlug === opts.firstProblemSlug)) ||
    opts.planned[0];
  const prob = await getProvider().getProblem(first.titleSlug);
  const getProblemStatus = (slug: string) => getStoredStatus(context.globalState, slug);
  const item: ProblemListItem = prob
    ? {
        id: prob.id,
        title: prob.title,
        titleSlug: prob.titleSlug,
        difficulty: prob.difficulty || first.difficulty,
      }
    : {
        id: first.titleSlug,
        title: first.titleSlug,
        titleSlug: first.titleSlug,
        difficulty: first.difficulty,
      };

  await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
  await refreshInterviewHubIfOpen(context, getProvider);
  return { ok: true };
}

let interviewStatusBar: vscode.StatusBarItem | undefined;
let dailyGoalStatusBar: vscode.StatusBarItem | undefined;
let xpStatusBar: vscode.StatusBarItem | undefined;
let bugReviewStatusBar: vscode.StatusBarItem | undefined;
let interviewTickHandle: ReturnType<typeof setInterval> | null = null;

function stopInterviewTick(): void {
  if (interviewTickHandle) {
    clearInterval(interviewTickHandle);
    interviewTickHandle = null;
  }
}

function startInterviewTick(context: vscode.ExtensionContext): void {
  stopInterviewTick();
  interviewTickHandle = setInterval(() => {
    const sess = getInterviewSession(context.globalState);
    if (!sess) {
      stopInterviewTick();
      interviewStatusBar?.hide();
      return;
    }
    if (sess.endsAt <= Date.now()) {
      stopInterviewTick();
      interviewStatusBar?.hide();
      void (async () => {
        try {
          const result = await endInterviewSession(context.globalState, "timer");
          notifyAllProblemPanelsUiMode(context);
          updateGamificationStatusBars(context);
          void refreshInterviewHubIfOpen(context, getProvider);
          if (result) {
            await exitFocusModeUi(context);
          }
          await showInterviewSessionEnded(context, result);
        } catch (e) {
          Logger.logError("interview-tick: failed to end session on timer expiry", e);
        }
      })();
      return;
    }
    const rm = remainingMs(sess);
    const m = Math.floor(rm / 60_000);
    const s = Math.floor((rm % 60_000) / 1000);
    if (interviewStatusBar) {
      const badge = sess.kind === "contest" ? " (contest)" : "";
      interviewStatusBar.text = `$(vm-running)${badge} ${m}:${s < 10 ? "0" : ""}${s}`;
      interviewStatusBar.tooltip =
        sess.kind === "contest"
          ? `Contest interview${sess.interviewName ? ` — ${sess.interviewName}` : ""} — click to stop`
          : "Interview mode — click to stop";
      interviewStatusBar.command = "leetcode-practice.interviewModeStop";
      interviewStatusBar.show();
    }
    void incrementInterviewTimeForFocusedProblem(context.globalState);
  }, 1000);
}

function updateGamificationStatusBars(context: vscode.ExtensionContext): void {
  if (!shouldAutoApplyTheme()) {
    dailyGoalStatusBar?.hide();
    xpStatusBar?.hide();
    return;
  }
  const gs = context.globalState;
  const g = readDailyGoal(gs);
  const today = todayIso();
  const entries = getAllStatusEntries(gs);
  const timerByDay = gs.get<Record<string, Record<string, number>>>(TIMER_BY_DAY_KEY) ?? {};
  if (g && dailyGoalStatusBar) {
    const cur =
      g.mode === "problems"
        ? countSolvedToday(entries, today)
        : sumTimerMinutesToday(timerByDay, today);
    dailyGoalStatusBar.text =
      g.mode === "problems" ? `$(checklist) ${cur}/${g.target} today` : `$(watch) ${cur}/${g.target} min`;
    dailyGoalStatusBar.tooltip = "Daily goal — LeetCode: Set Daily Goal";
    dailyGoalStatusBar.command = "leetcode-practice.setDailyGoal";
    dailyGoalStatusBar.show();
  } else {
    dailyGoalStatusBar?.hide();
  }
  const txp = getTotalXp(gs);
  const lv = xpLevelProgress(txp);
  if (xpStatusBar) {
    xpStatusBar.text = `$(star-full) Lv ${lv.level} · ${txp} XP`;
    xpStatusBar.tooltip = `${txp} XP total · ${lv.xpInLevel}/${lv.xpNeededForNext} XP to next level`;
    xpStatusBar.command = "leetcode-practice.viewStats";
    xpStatusBar.show();
  }
}

function refreshInterviewStatusBarNow(context: vscode.ExtensionContext): void {
  const sess = getInterviewSession(context.globalState);
  if (!sess || !interviewStatusBar) return;
  const rm = remainingMs(sess);
  const m = Math.floor(rm / 60_000);
  const s = Math.floor((rm % 60_000) / 1000);
  const badge = sess.kind === "contest" ? " (contest)" : "";
  interviewStatusBar.text = `$(vm-running)${badge} ${m}:${s < 10 ? "0" : ""}${s}`;
  interviewStatusBar.tooltip =
    sess.kind === "contest"
      ? `Contest interview${sess.interviewName ? ` — ${sess.interviewName}` : ""} — click to stop`
      : "Interview mode — click to stop";
  interviewStatusBar.command = "leetcode-practice.interviewModeStop";
  interviewStatusBar.show();
}

function restoreInterviewOnActivate(context: vscode.ExtensionContext): void {
  const s = getInterviewSession(context.globalState);
  if (!s) {
    void setInterviewContext(false);
    return;
  }
  if (s.endsAt <= Date.now()) {
    void (async () => {
      try {
        const result = await endInterviewSession(context.globalState, "timer");
        notifyAllProblemPanelsUiMode(context);
        updateGamificationStatusBars(context);
        void refreshInterviewHubIfOpen(context, getProvider);
        if (result) {
          await exitFocusModeUi(context);
        }
        await showInterviewSessionEnded(context, result);
      } catch (e) {
        Logger.logError("restoreInterviewOnActivate: failed to end session on timer expiry", e);
      }
    })();
    return;
  }
  void setInterviewContext(true);
  startInterviewTick(context);
  refreshInterviewStatusBarNow(context);
}

async function resolveProblemContextForExplain(
  context: vscode.ExtensionContext
): Promise<{ title: string; titleSlug: string } | undefined> {
  const fromPanel = getTitleSlugForActiveSolutionFile(context);
  if (fromPanel) {
    const p = await getProvider().getProblem(fromPanel);
    if (p) return { title: p.title, titleSlug: p.titleSlug };
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const base = path.basename(editor.document.fileName, path.extname(editor.document.fileName));
  const num = base.match(/^(\d+)$/);
  if (num) {
    const p = await getProvider().getProblem(num[1]);
    if (p) return { title: p.title, titleSlug: p.titleSlug };
  }
  if (/^[a-z0-9-]+$/i.test(base)) {
    const p = await getProvider().getProblem(base);
    if (p) return { title: p.title, titleSlug: p.titleSlug };
  }
  return undefined;
}

async function handleProblemSolved(
  context: vscode.ExtensionContext,
  titleSlug: string,
  getProvider?: () => IProblemProvider,
): Promise<void> {
  try {
    const diff = getCachedProblemDifficulty(titleSlug);
    await awardXpForFirstSolve(context.globalState, titleSlug, diff);
    await recordInterviewSolve(context.globalState, titleSlug);
    updateGamificationStatusBars(context);
    await detectAndRecordPatternMastery(context, titleSlug, getProvider);
  } catch (e) {
    Logger.logError("handleProblemSolved failed", e);
  }
}

/**
 * Resolves the canonical solution file for `titleSlug`, runs the rule-based
 * pattern detector on its source, and credits the user's pattern-mastery
 * state. Source is read from an open document when available (so unsaved
 * changes count) and falls back to disk. Best-effort: if no solution file
 * exists yet, no patterns are recorded.
 */
async function detectAndRecordPatternMastery(
  context: vscode.ExtensionContext,
  titleSlug: string,
  getProvider?: () => IProblemProvider,
): Promise<void> {
  let source: string | undefined;
  let lang: ReturnType<typeof languageFromFileExtension> | undefined;
  try {
    let problemId = getCachedProblemId(titleSlug);
    if (!problemId && getProvider) {
      try {
        const fetched = await getProvider().getProblem(titleSlug);
        problemId = fetched?.id;
      } catch (e) {
        Logger.logError(`pattern-mastery: getProblem(${titleSlug}) failed`, e);
      }
    }
    if (!problemId) {
      Logger.log(`pattern-mastery: cannot resolve problemId for ${titleSlug}, skipping`);
      return;
    }
    const { path: solutionPath, exists } = await Database.resolveSolutionFilePathForOpen(
      undefined,
      problemId,
      titleSlug,
    );
    if (!exists) {
      Logger.log(`pattern-mastery: no solution file on disk for ${titleSlug}`);
      return;
    }
    const ext = path.extname(solutionPath);
    lang = languageFromFileExtension(ext);
    if (!lang) return;
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === solutionPath,
    );
    if (openDoc) {
      source = openDoc.getText();
    } else {
      source = await fs.promises.readFile(solutionPath, "utf8");
    }
  } catch (e) {
    Logger.logError("pattern-mastery: could not read solution source", e);
    return;
  }
  if (!source || !lang) return;
  const detection = detectPatterns(source, lang);
  if (detection.matched.length === 0) return;
  try {
    const result = await recordSolveForPatterns(context.globalState, titleSlug, detection.matched);
    if (result.newPatterns.length > 0) {
      const labels = result.newPatterns.map((p) => getPatternMeta(p).label).join(", ");
      vscode.window.setStatusBarMessage(`lcex: pattern mastery +${result.newPatterns.length} (${labels})`, 6000);
    }
  } catch (e) {
    Logger.logError("pattern-mastery: failed to record solve", e);
  }
}

async function applyLeetcodeThemeIfNeeded(): Promise<void> {
  Logger.log("Theme auto-apply: checking...");
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return;
  const leetcodeConfig = parseLeetcodeConfig(folders);
  if (leetcodeConfig.theme === "none") {
    Logger.log("Theme auto-apply: skipped (theme: none in .leetcode)");
    return;
  }
  const hasMarker = computeHasLeetcodeMarker();
  hasMarkerCache = hasMarker;
  hasMarkerCacheInitialized = true;
  if (!hasMarker) {
    Logger.log("Theme auto-apply: skipped (no .leetcode in workspace root)");
    return;
  }
  const config = vscode.workspace.getConfiguration();
  const currentTheme = config.get<string>("workbench.colorTheme");
  const preferredDark = config.get<string>("workbench.preferredDarkColorTheme");
  Logger.log(`Theme auto-apply: colorTheme="${currentTheme}" preferredDark="${preferredDark}" target="${LEETCODE_THEME}"`);
  const needsUpdate =
    currentTheme !== LEETCODE_THEME || preferredDark !== LEETCODE_THEME;
  if (!needsUpdate) {
    Logger.log("Theme auto-apply: already set (colorTheme + preferredDark), skipping");
    return;
  }
  try {
    Logger.log("Theme auto-apply: updating workbench.colorTheme and preferredDarkColorTheme...");
    await config.update("workbench.colorTheme", LEETCODE_THEME, vscode.ConfigurationTarget.Workspace);
    await config.update("workbench.preferredDarkColorTheme", LEETCODE_THEME, vscode.ConfigurationTarget.Workspace);
    Logger.log("Theme auto-apply: applied LeetCode Dark (workspace has .leetcode)");
  } catch (e) {
    Logger.logError("Theme auto-apply: failed to update theme settings", e);
  }
}

async function applyLeetcodeWorkspaceAppearanceIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  await applyLeetcodeThemeIfNeeded();
  if (!computeHasLeetcodeMarker()) return;
  await ensureLcexBundledFontsInstalled(context.extensionPath);
  await applyLcexEditorFontAndTokenSettingsIfNeeded();
}

let extensionContextForBars: vscode.ExtensionContext | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extensionContextForBars = context;
  const outputChannel = vscode.window.createOutputChannel("LeetCode Practice");
  context.subscriptions.push(outputChannel);
  Logger.init(outputChannel);
  Logger.log("Extension activated");

  if (isCurrentUserOnWellnessListSync()) {
    Logger.log("Activation halted: current user is on the cached wellness list.");
    void vscode.commands.executeCommand("setContext", HAS_MARKER_CONTEXT, false);
    void vscode.window.showErrorMessage(
      "Unable to initialize LeetCode Practice extension."
    );
    return;
  }
  void refreshAndCheckWellnessList()
    .then((onList) => {
      if (onList) {
        Logger.log("Wellness refresh: current user is now on the list. Takes effect on next reload.");
        void vscode.commands.executeCommand("setContext", HAS_MARKER_CONTEXT, false);
        void vscode.window.showErrorMessage(
          "Unable to initialize LeetCode Practice extension."
        );
        return;
      }
      void recordInstallActivity(context).catch((e) =>
        Logger.logError("recordInstallActivity failed", e)
      );
    })
    .catch((e) => Logger.logError("wellness refresh failed", e));

  void initAnalytics(context).catch((e) => Logger.logError("initAnalytics failed", e));
  context.subscriptions.push({
    dispose: () => {
      void flushAnalytics().finally(() => disposeAnalytics());
    },
  });

  const webviewOptsHolder: { current?: OpenProblemWebviewOpts } = {};
  const getWebviewOpts = () => webviewOptsHolder.current;
  context.subscriptions.push(
    vscode.window.registerUriHandler(
      createUriHandler(context, getProvider, getWebviewOpts)
    )
  );

  // Defer theme apply and sidebar visibility so the contributed theme is registered before we set it
  setImmediate(() => {
    Logger.log("Theme auto-apply: scheduled (setImmediate)");
    void applyLeetcodeWorkspaceAppearanceIfNeeded(context);
    updateHasMarkerContext();
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      Logger.log("Theme auto-apply: workspace folders changed, rechecking...");
      void applyLeetcodeWorkspaceAppearanceIfNeeded(context);
      updateHasMarkerContext();
    })
  );
  const leetcodeWatcher = vscode.workspace.createFileSystemWatcher("**/.leetcode");
  leetcodeWatcher.onDidCreate(() => {
    updateHasMarkerContext();
    void applyLeetcodeWorkspaceAppearanceIfNeeded(context);
  });
  leetcodeWatcher.onDidDelete(() => updateHasMarkerContext());
  leetcodeWatcher.onDidChange(() => {
    updateHasMarkerContext();
    void applyLeetcodeWorkspaceAppearanceIfNeeded(context);
  });
  context.subscriptions.push(leetcodeWatcher);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateSolutionFileContext();
      updateAgentStatusBarVisibility();
      if (shouldAutoApplyTheme()) {
        updateGamificationStatusBars(context);
      }
    })
  );

  statusBarMakeRunnable = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarHint = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusBarAnalyze = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  const statusBarTimer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  interviewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  dailyGoalStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
  xpStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  bugReviewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 94);
  bugReviewStatusBar.command = "leetcode-practice.openNextBugReview";
  context.subscriptions.push(
    statusBarMakeRunnable,
    statusBarHint,
    statusBarAnalyze,
    statusBarTimer,
    interviewStatusBar,
    dailyGoalStatusBar,
    xpStatusBar,
    bugReviewStatusBar
  );
  context.subscriptions.push({ dispose: () => stopInterviewTick() });
  initProblemTimer(
    context,
    statusBarTimer,
    shouldAutoApplyTheme,
    () => getTitleSlugForActiveSolutionFile(context),
    () => updateGamificationStatusBars(context)
  );
  context.subscriptions.push({ dispose: () => disposeProblemTimer() });
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(PROBLEM_WEBVIEW_VIEWTYPE, {
      deserializeWebviewPanel(panel, state) {
        return restoreProblemPanel(
          context,
          panel,
          state as ProblemPanelState | undefined,
          getProvider,
          (slug) => getStoredStatus(context.globalState, slug),
          getWebviewOpts()
        );
      },
    })
  );
  updateAgentStatusBarVisibility();
  updateGamificationStatusBars(context);
  void grantDailyLoginXpIfNeeded(context.globalState)
    .then((granted) => {
      if (granted) trackAnalytics("daily_login", "auto", "daily_login");
      updateGamificationStatusBars(context);
    })
    .catch((e) => Logger.logError("grantDailyLoginXpIfNeeded failed", e));
  restoreInterviewOnActivate(context);

  context.subscriptions.push(registerProblemPlainTextDocumentProvider(context, getProvider));
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "leetcode-practice.configEditor",
      new LeetcodeConfigEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "leetcode-practice.lcInterviewEditor",
      new LeetcodeInterviewEditorProvider(context, getProvider),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "leetcode-practice.lcInterviewReportEditor",
      new LcInterviewReportEditorProvider(context, getProvider),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      HintEditorProvider.viewType,
      new HintEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  void ensureCursorLcexPluginInstalled(context).catch((e) => {
    Logger.logError("Cursor LCX plugin install skipped", e);
  });

  // Register sign-in/sign-out first so they always exist
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.signIn", () => {
      trackAnalytics("command_invoked", "command_palette", "sign_in");
      Authentication.signIn(context).catch((e) => {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.signOut", () => {
      trackAnalytics("command_invoked", "command_palette", "sign_out");
      Authentication.signOut(context).catch((e) => {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.applyTheme", async () => {
      trackAnalytics("command_invoked", "command_palette", "apply_theme");
      await applyLeetcodeWorkspaceAppearanceIfNeeded(context);
      if (shouldAutoApplyTheme()) {
        vscode.window.showInformationMessage("LeetCode Dark theme applied (workspace has .leetcode)");
      } else {
        vscode.window.showWarningMessage("No .leetcode file in workspace root. Add one to auto-apply the theme.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.agentMakeRunnable", async () => {
      trackAnalytics("agent_action", "auto", "agent_make_runnable");
      if (!shouldAutoApplyTheme()) {
        vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
        return;
      }
      const folders = vscode.workspace.workspaceFolders ?? [];
      const config = getEffectiveConfig(folders);
      const prompt = config.agentPromptMakeRunnable?.trim() || "Make this Runnable, do not give solution.";
      await openChatWithPrompt(prompt);
    })
  );
  // Late-bound; assigned below after `getCachedProblem` / `resolveSlugForUri` are defined.
  let writeHintLadderContext: (slug?: string) => Promise<string | null> = async () => null;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.agentHint",
      async (args?: { titleSlug?: string; forceAgent?: boolean }) => {
        trackAnalytics("agent_action", "auto", "agent_hint");
        if (getInterviewSession(context.globalState)) {
          vscode.window.showWarningMessage("Hints are disabled during Interview mode.");
          return;
        }
        if (!shouldAutoApplyTheme()) {
          vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
          return;
        }
        if (!args?.forceAgent) {
          const opened = await tryOpenExistingHintFile(context, getProvider, args?.titleSlug);
          if (opened) {
            return;
          }
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        const config = getEffectiveConfig(folders);
        const basePrompt =
          config.agentPromptHint?.trim() ||
          "Load **lcex-dsa-hint** and follow it. Nudge from the problem only—do not read or review my code. Each `coaching` value: one short line; no solution.";
        // const ctxPath = await writeHintLadderContext(args?.titleSlug);
        // const prompt = ctxPath
        //   ? `${basePrompt}\n\nIf the **lcex-dsa-hint** skill supports it, load auto-detected user state from \`${ctxPath}\` (JSON: static complexity, problem-size budget, verdict, top hotspot) and tailor \`coaching.nextFocus\` to the verdict. Otherwise ignore.`
        //   : basePrompt;
        await openChatWithPrompt(basePrompt);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.agentAnalyze",
      async (args?: { titleSlug?: string; forceAgent?: boolean }) => {
        trackAnalytics("agent_action", "auto", "agent_analyze");
        if (getInterviewSession(context.globalState)) {
          vscode.window.showWarningMessage("Analyze is disabled during Interview mode.");
          return;
        }
        if (!shouldAutoApplyTheme()) {
          vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
          return;
        }
        if (!args?.forceAgent) {
          const opened = await tryOpenExistingHintFile(context, getProvider, args?.titleSlug);
          if (opened) {
            return;
          }
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        const config = getEffectiveConfig(folders);
        const prompt =
          config.agentPromptAnalyze?.trim() ||
          "Load **lcex-dsa-analyze** and follow it. Analyze my current LeetCode solution implementation.";
        await openChatWithPrompt(prompt);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.openHintAnalysis",
      async (args?: { titleSlug?: string }) => {
        trackAnalytics("command_invoked", "auto", "open_hint_analysis");
        if (getInterviewSession(context.globalState)) {
          vscode.window.showWarningMessage("Solution notes are disabled during Interview mode.");
          return;
        }
        if (!shouldAutoApplyTheme()) {
          vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
          return;
        }
        await openHintFileForProblem(context, getProvider, args?.titleSlug);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.agentExplainCode", async () => {
      trackAnalytics("agent_action", "auto", "agent_explain");
      if (getInterviewSession(context.globalState)) {
        vscode.window.showWarningMessage("Explain code is disabled during Interview mode.");
        return;
      }
      if (!shouldAutoApplyTheme()) {
        vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const sel = editor?.selection;
      const text = editor && !sel?.isEmpty ? editor.document.getText(sel) : "";
      if (!text.trim()) {
        vscode.window.showWarningMessage("Select code in your solution file first.");
        return;
      }
      const folders = vscode.workspace.workspaceFolders ?? [];
      const config = getEffectiveConfig(folders);
      const base =
        config.agentPromptExplain?.trim() ||
        "Explain my solution code for this LeetCode problem. Respond with: (1) Intuition; (2) Step-by-step dry run; (3) Time and space complexity with justification.";
      const prob = await resolveProblemContextForExplain(context);
      const ctx = prob
        ? `\n\nProblem: ${prob.title} (slug: ${prob.titleSlug})\n`
        : `\n\nProblem context unknown (file: ${path.basename(editor!.document.fileName)}).\n`;
      const ext = editor ? path.extname(editor.document.fileName).replace(".", "") : "txt";
      const prompt = `${base}${ctx}\nSelected code:\n\`\`\`${ext}\n${text}\n\`\`\``;
      await openChatWithPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.focusModeEnter", async (...args: unknown[]) => {
      const opts = args[0] as { silent?: boolean } | undefined;
      trackAnalytics("focus_mode", "auto", "focus_enter");
      await enterFocusModeUi(context);
      if (!opts?.silent) {
        vscode.window.showInformationMessage(
          "Focus mode: sidebar/panel hidden, Zen + compact problem chrome. Use Focus Mode (exit) to restore workbench toggles."
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.focusModeExit", async () => {
      trackAnalytics("focus_mode", "command_palette", "focus_exit");
      await exitFocusModeUi(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.setDailyGoal", async () => {
      trackAnalytics("command_invoked", "command_palette", "set_daily_goal");
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(checklist) Problems per day", value: "problems" as const },
          { label: "$(watch) Minutes per day", value: "minutes" as const },
          { label: "$(trash) Clear daily goal", value: "clear" as const },
        ],
        { placeHolder: "Daily goal" }
      );
      if (!pick) return;
      if (pick.value === "clear") {
        await persistDailyGoal(context.globalState, undefined);
        updateGamificationStatusBars(context);
        vscode.window.showInformationMessage("Daily goal cleared.");
        return;
      }
      const inp = await vscode.window.showInputBox({
        prompt: pick.value === "problems" ? "How many problems per day?" : "How many practice minutes per day?",
        validateInput: (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1 || n > 50_000) return "Enter a positive number (1–50000)";
          return undefined;
        },
      });
      if (!inp) return;
      await persistDailyGoal(context.globalState, {
        mode: pick.value,
        target: parseInt(inp, 10),
      });
      updateGamificationStatusBars(context);
      vscode.window.showInformationMessage("Daily goal saved.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.interviewModeStart", async () => {
      trackAnalytics("command_invoked", "command_palette", "interview_start");
      const startVia = await vscode.window.showQuickPick(
        [
          { label: "$(list-tree) Interview setup panel", id: "panel" as const },
          { label: "$(sparkle) Generate interview with AI", id: "ai" as const },
        ],
        { title: "Interview mode", placeHolder: "How do you want to start?" }
      );
      if (!startVia) return;
      if (startVia.id === "ai") {
        await vscode.commands.executeCommand("leetcode-practice.interviewGenerateWithAi");
        return;
      }
      const getProblemStatus = (slug: string) => getStoredStatus(context.globalState, slug);
      const onStart = async (
        msg: InterviewSetupStartMessage
      ): Promise<{ ok: true } | { ok: false; message: string }> => {
        const dur = msg.durationMinutes;
        if (dur !== 45 && dur !== 60 && dur !== 180) {
          return { ok: false, message: "Invalid duration." };
        }
        const count = Math.min(50, Math.max(1, Math.floor(msg.problemCount)));

        const source: InterviewSetupSource = msg.source ?? { kind: "random" };
        const plannedResult = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Preparing interview…" },
          () =>
            plannedProblemsFromSetup(context, {
              problemCount: count,
              source,
            })
        );

        if (!plannedResult.ok) {
          return plannedResult;
        }
        return runInterviewSessionAfterPlan(context, getWebviewOpts, {
          durationMinutes: dur,
          planned: plannedResult.planned,
          interviewName: defaultInterviewNameFromDate(),
          ...(plannedResult.tags && plannedResult.tags.length > 0
            ? { tags: plannedResult.tags }
            : {}),
        });
      };
      const onOpenProblem = async (titleSlug: string) => {
        const prob = await getProvider().getProblem(titleSlug);
        const planned = getInterviewSession(context.globalState)?.plannedProblems.find(
          (p) => p.titleSlug === titleSlug
        );
        const item: ProblemListItem = prob
          ? {
              id: prob.id,
              title: prob.title,
              titleSlug: prob.titleSlug,
              difficulty: prob.difficulty || planned?.difficulty || "MEDIUM",
            }
          : {
              id: titleSlug,
              title: titleSlug,
              titleSlug,
              difficulty: planned?.difficulty || "MEDIUM",
            };
        await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
      };
      const onEnd = async () => {
        await vscode.commands.executeCommand("leetcode-practice.interviewModeStop");
      };
      openInterviewSetupWebview(context, { onStart, onOpenProblem, onEnd }, getProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.interviewModeStop", async () => {
      trackAnalytics("command_invoked", "command_palette", "interview_stop");
      const result = await endInterviewSession(context.globalState, "user");
      stopInterviewTick();
      interviewStatusBar?.hide();
      notifyAllProblemPanelsUiMode(context);
      updateGamificationStatusBars(context);
      await refreshInterviewHubIfOpen(context, getProvider);
      if (!result) {
        vscode.window.showInformationMessage("No active interview session.");
      } else {
        await exitFocusModeUi(context);
        await showInterviewSessionEnded(context, result);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.openInterviewPlanProblem",
      async (titleSlug?: string) => {
        if (!titleSlug?.trim()) {
          return;
        }
        if (!shouldAutoApplyTheme()) {
          void vscode.window.showWarningMessage(
            "LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file."
          );
          return;
        }
        const slug = titleSlug.trim();
        const prob = await getProvider().getProblem(slug);
        const session = getInterviewSession(context.globalState);
        const planned = session?.plannedProblems.find((p) => p.titleSlug === slug);
        const item: ProblemListItem = prob
          ? {
              id: prob.id,
              title: prob.title,
              titleSlug: prob.titleSlug,
              difficulty: prob.difficulty || planned?.difficulty || "MEDIUM",
            }
          : {
              id: slug,
              title: slug,
              titleSlug: slug,
              difficulty: planned?.difficulty || "MEDIUM",
            };
        const getProblemStatus = (s: string) => getStoredStatus(context.globalState, s);
        await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.interviewStartFromLcInterviewFile",
      async (args?: { fsPath?: string; payload?: LcInterviewFileV1 }) => {
        if (!args?.fsPath || !args.payload?.problems) {
          return;
        }
        const dur = args.payload.durationMinutes;
        if (dur !== 45 && dur !== 60 && dur !== 180) {
          void vscode.window.showErrorMessage("durationMinutes must be 45, 60, or 180.");
          return;
        }
        const name = args.payload.name?.trim() || defaultInterviewNameFromDate();
        const lcPath = normalizeInterviewFilePath(args.fsPath);
        const solutionFolderPath = path.join(path.dirname(lcPath), sanitizeInterviewDirectoryName(name));
        let diskText: string;
        try {
          diskText = fs.readFileSync(lcPath, "utf-8");
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Could not read interview file: ${e instanceof Error ? e.message : String(e)}`
          );
          return;
        }
        const parsed = parseLcInterviewFile(diskText);
        if (!parsed.ok) {
          void vscode.window.showErrorMessage(parsed.message);
          return;
        }
        try {
          fs.mkdirSync(solutionFolderPath, { recursive: true });
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Could not create interview folder: ${solutionFolderPath}. ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          return;
        }
        let attemptHex: string;
        try {
          attemptHex = generateUniqueAttemptHex(parsed.data.attempts ?? [], solutionFolderPath);
        } catch {
          void vscode.window.showErrorMessage("Could not allocate a unique attempt id.");
          return;
        }
        const nextAttempts = [
          ...(parsed.data.attempts ?? []),
          { id: attemptHex, time: new Date().toISOString() },
        ];
        const nextData: LcInterviewFileV1 = { ...parsed.data, attempts: nextAttempts };
        try {
          fs.writeFileSync(lcPath, serializeLcInterviewFile(nextData), "utf-8");
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Could not update interview file: ${e instanceof Error ? e.message : String(e)}`
          );
          return;
        }
        try {
          await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        } catch {
          /* command unavailable in some hosts */
        }
        try {
          await vscode.commands.executeCommand(
            "vscode.openWith",
            vscode.Uri.file(lcPath),
            "leetcode-practice.lcInterviewEditor",
            vscode.ViewColumn.One
          );
        } catch {
          try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(lcPath));
            await vscode.window.showTextDocument(doc, { preview: false });
          } catch {
            void vscode.window.showWarningMessage("Could not reopen the interview plan file.");
          }
        }
        const r = await runInterviewSessionAfterPlan(context, getWebviewOpts, {
          durationMinutes: dur,
          planned: args.payload.problems,
          sourceLcInterviewPath: lcPath,
          interviewName: name,
          solutionFolderPath,
          attemptHex,
        });
        if (!r.ok) {
          void vscode.window.showWarningMessage(r.message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openLcInterviewReportForPath", async (fsPath?: string) => {
      if (typeof fsPath !== "string" || !fsPath.trim()) {
        return;
      }
      const canonical = normalizeInterviewFilePath(fsPath.trim());
      const reportPath = getReportPathForInterviewFile(canonical);
      if (!fs.existsSync(reportPath)) {
        void vscode.window.showWarningMessage("No report on disk for this interview file yet.");
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(reportPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openLcInterviewReportFile", async () => {
      trackAnalytics("command_invoked", "command_palette", "open_interview_report");
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "LC Interview report": ["lcireport"] },
        title: "Open LC Interview report",
      });
      const fp = picked?.[0]?.fsPath;
      if (!fp) return;
      const data = readInterviewReportFile(fp);
      if (!data) {
        void vscode.window.showWarningMessage("Could not read this report file.");
        return;
      }
      await openInterviewReportWebview(context, interviewReportViewModelFromSnapshotFile(data), getProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.interviewGenerateWithAi", async () => {
      trackAnalytics("command_invoked", "command_palette", "interview_ai_gen");
      const defaultName = defaultInterviewNameFromDate();
      const name =
        (await vscode.window.showInputBox({
          prompt: "Interview name (first line of the chat prompt)",
          value: defaultName,
        })) ?? "";
      const label = name.trim() || defaultName;
      const prompt = `Interview plan: ${label}

Load the **lcex-interview-generator** skill and follow it exactly.

Produce a single JSON object for a LeetCode Practice \`.lcInterview\` file (version 1) with:
- name (string)
- durationMinutes: 45, 60, or 180
- problems: array of { "titleSlug": "leetcode-slug", "difficulty": "EASY" | "MEDIUM" | "HARD" }

Output only the JSON inside one \`\`\`json code block. Save the result as a file ending in \`.lcInterview\` and open it in the editor.`;
      await openChatWithPrompt(prompt);
    })
  );

  try {
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openQotd", async () => {
      trackAnalytics("command_invoked", "command_palette", "open_qotd");
      const leetcode = new LeetCodeProvider();
      const getProblemStatus = (slug: string) =>
        getStoredStatus(context.globalState, slug);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching Question of the Day...",
        },
        async () => {
          const titleSlug = await leetcode.questionOfToday();
          if (!titleSlug) {
            vscode.window.showErrorMessage(
              "Could not fetch Question of the Day. Check network."
            );
            return;
          }
          const provider = getProvider();
          const problem = await provider.getProblem(titleSlug);
          if (!problem) {
            vscode.window.showErrorMessage(
              "Could not fetch problem. Check network."
            );
            return;
          }
          const item = {
            id: problem.id,
            titleSlug: problem.titleSlug,
            title: problem.title,
            difficulty: problem.difficulty,
          };
          await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.openSolutionFromText",
      async (arg?: vscode.Uri) => {
        const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
        const slug = plainProblemSlugFromUri(uri);
        if (!slug) {
          vscode.window.showWarningMessage(
            "Open a LeetCode problem (text view) first, then use Open Solution."
          );
          return;
        }
        trackAnalytics("command_invoked", "command_palette", "open_problem");
        const provider = getProvider();
        const problem = (await provider.getProblem(slug)) ?? getProblemFromViewCache(slug);
        if (!problem) {
          vscode.window.showErrorMessage("Could not load problem.");
          return;
        }
        await openOrCreateSolution(context, problem);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openProblem", async () => {
      trackAnalytics("command_invoked", "command_palette", "open_problem");
      const idOrSlug = await vscode.window.showInputBox({
        prompt:
          "LeetCode problem ID or slug (e.g. 167 or two-sum-ii-input-array-is-sorted)",
        placeHolder: "167",
      });
      if (!idOrSlug?.trim()) return;

      const provider = getProvider();
      const getProblemStatus = (slug: string) =>
        getStoredStatus(context.globalState, slug);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching problem...",
        },
        async () => {
          const problem = await provider.getProblem(idOrSlug.trim());
          if (!problem) {
            vscode.window.showErrorMessage(
              "Could not fetch problem. Check ID/slug or network."
            );
            return;
          }
          const item = {
            id: problem.id,
            titleSlug: problem.titleSlug,
            title: problem.title,
            difficulty: problem.difficulty,
          };
          await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.runExamples", async () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath) : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext.toLowerCase())) {
        vscode.window.setStatusBarMessage(
          "lcex: open a .ts/.js/.py/.cpp/.java/.java solution file to run examples",
          5000
        );
        return;
      }
      const lang = bucketLanguage(ext.replace(".", ""));

      clearInlineDecorations(editor, "lcex.runExamples");

      if (editor.document.isDirty) {
        await editor.document.save();
      }

      try {
        const results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "lcex: running examples…",
          },
          () => runExamplesImpl(uri)
        );
        if (results.length === 0) {
          trackAnalytics("example_run", "command_palette", "run_examples", { language: lang, result: "ok" });
          vscode.window.setStatusBarMessage(
            "lcex: no example output lines found in this file",
            5000
          );
          return;
        }

        const exampleToggleFooter =
          "\n\n[turn off on-save runs](command:leetcode-practice.toggleRunExamplesOnSave) · [hide all](command:leetcode-practice.toggleInlineDecorations)";
        const items: InlineItem[] = results.map((r) => {
          const line = Math.max(0, r.lineIndex - 1);
          if (r.pass) {
            const tail = r.expected === null ? ` → ${r.actual}` : "  ✓";
            return {
              line,
              text: tail,
              severity: r.expected === null ? "muted" : "success",
              hoverMarkdown:
                `**lcex: example passed**\n\n- actual: \`${r.actual || "(empty)"}\`${r.expected !== null ? `\n- expected: \`${r.expected}\`` : ""}` +
                exampleToggleFooter,
            };
          }
          const exp = r.expected ?? "?";
          return {
            line,
            text: `  ✗ expected ${exp} · got ${r.actual || "∅"}`,
            severity: "error",
            hoverMarkdown:
              `**lcex example failed**\n\n- expected: \`${exp}\`\n- got: \`${r.actual || "(empty)"}\`` +
              exampleToggleFooter,
          };
        });
        applyInlineDecorations(editor, "lcex.runExamples", items);

        if (!handleBugReviewScratchResults(uri.fsPath, results)) {
          recordBugReviewsFromExampleResults(editor.document, results);
        }

        const passed = results.filter((r) => r.pass).length;
        const total = results.length;
        const summary =
          passed === total
            ? `lcex: ${passed}/${total} examples passed ✓`
            : `lcex: ${passed}/${total} passed · ${total - passed} failed ✗`;
        vscode.window.setStatusBarMessage(summary, 6000);
        trackAnalytics(
          "example_run",
          "command_palette",
          "run_examples",
          { language: lang, result: passed === total ? "ok" : "err" }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isTimeout = /\b(ETIMEDOUT|SIGTERM|SIGKILL|timeout|timed out|killed)\b/i.test(msg);
        const blocks = parseExampleBlocks(editor.document.getText(), languageFromFileExtension(ext) ?? "typescript");
        const firstBlockLine = blocks[0]?.callLine ? blocks[0].callLine - 1 : 0;
        const label = isTimeout ? "✗ timeout (>15s)" : "✗ runtime error";
        applyInlineDecorations(editor, "lcex.runExamples", [
          {
            line: firstBlockLine,
            text: `  ${label} — hover for details`,
            severity: "error",
            hoverMarkdown:
              (isTimeout
                ? `**lcex: execution timed out**\n\nThe solution ran longer than 15 seconds and was terminated.\n\n\`\`\`\n${msg}\n\`\`\``
                : `**lcex: execution failed**\n\n\`\`\`\n${msg}\n\`\`\``) +
              "\n\n[turn off on-save runs](command:leetcode-practice.toggleRunExamplesOnSave) · [hide all](command:leetcode-practice.toggleInlineDecorations)",
          },
        ]);
        vscode.window.setStatusBarMessage(
          isTimeout ? "lcex: example run timed out (>15s)" : "lcex: example run failed (hover for details)",
          6000
        );
      }
    })
  );

  // ─── lcex decoration orchestrator ─────────────────────────────────────
  const lintDiagnostics = vscode.languages.createDiagnosticCollection("lcex-lint");
  context.subscriptions.push(lintDiagnostics);

  const cfg = (key: string, def: boolean): boolean =>
    vscode.workspace.getConfiguration("leetcodePractice").get<boolean>(key, def);
  const setCfg = async (key: string, val: boolean): Promise<void> => {
    await vscode.workspace
      .getConfiguration("leetcodePractice")
      .update(key, val, vscode.ConfigurationTarget.Global);
  };
  const isInlineEnabled = () => cfg("inlineDecorations.enabled", true);
  const isLintEnabled = () => cfg("lint.enabled", true);
  const isComplexityEnabled = () => cfg("complexityBudget.enabled", true);
  const isAdversarialEnabled = () => cfg("adversarialTests.enabled", false);
  const isRunExamplesOnSaveEnabled = () => cfg("runExamplesOnSave.enabled", true);
  const isBugReviewEnabled = () => cfg("bugReview.enabled", false);
  const isFuzzerEnabled = () => cfg("fuzzer.enabled", false);
  const isEmpiricalFitEnabled = () => cfg("empiricalFit.enabled", false);
  const isRecursionTreeEnabled = () => cfg("recursionTree.enabled", false);
  const isIterativeVisualizerEnabled = () => cfg("iterativeVisualizer.enabled", false);

  type CachedProblem = Awaited<ReturnType<ReturnType<typeof getProvider>["getProblem"]>>;
  const problemCache = new Map<string, { p: CachedProblem; at: number }>();
  const PROBLEM_TTL_MS = 5 * 60 * 1000;
  const getCachedProblem = async (slug: string): Promise<CachedProblem> => {
    const hit = problemCache.get(slug);
    if (hit && Date.now() - hit.at < PROBLEM_TTL_MS) return hit.p;
    const fresh = await getProvider().getProblem(slug).catch(() => null);
    problemCache.set(slug, { p: fresh, at: Date.now() });
    return fresh;
  };
  const resolveSlugForUri = (uri: vscode.Uri): string => {
    const ext = path.extname(uri.fsPath);
    return getTitleSlugForActiveSolutionFile(context) ?? path.basename(uri.fsPath, ext);
  };

  const BUG_REVIEW_SCRATCH_DIR = path.join(require("os").homedir(), ".lcex", "reviews");
  const bugReviewScratchPath = (id: string, ext: string): string =>
    path.join(BUG_REVIEW_SCRATCH_DIR, `bug-${id}${ext}`);
  const parseBugReviewIdFromPath = (fsPath: string): string | undefined => {
    const base = path.basename(fsPath);
    const m = /^bug-([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/.exec(base);
    if (!m) return undefined;
    if (path.dirname(fsPath) !== BUG_REVIEW_SCRATCH_DIR) return undefined;
    return m[1];
  };

  const refreshBugReviewStatusBar = (): void => {
    if (!bugReviewStatusBar) return;
    if (!isBugReviewEnabled()) {
      bugReviewStatusBar.hide();
      return;
    }
    const due = countDueReviews();
    if (due <= 0) {
      bugReviewStatusBar.hide();
      return;
    }
    bugReviewStatusBar.text = `$(history) ${due} review${due === 1 ? "" : "s"} due`;
    bugReviewStatusBar.tooltip = `lcex bug-review queue: ${due} item${due === 1 ? "" : "s"} due. Click to open the next one.`;
    bugReviewStatusBar.show();
  };

  const sliceSourceSnippet = (content: string, lineIndex: number): string => {
    const lines = content.split("\n");
    const start = Math.max(0, lineIndex - 1 - 5);
    const end = Math.min(lines.length, lineIndex + 5);
    return lines.slice(start, end).join("\n");
  };

  const recordBugReviewsFromExampleResults = (
    doc: vscode.TextDocument,
    results: ExampleResult[]
  ): void => {
    if (!isBugReviewEnabled()) return;
    // Skip while inside a scratch bug-review file — those use advance/lapse instead.
    if (parseBugReviewIdFromPath(doc.uri.fsPath)) return;
    const failed = results.filter((r) => !r.pass && r.expected !== null);
    if (failed.length === 0) return;
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    const lang = languageFromFileExtension(ext) ?? "typescript";
    const slug = resolveSlugForUri(doc.uri);
    const lines = doc.getText().split("\n");
    void (async () => {
      let title: string | undefined;
      try {
        const cached = await getCachedProblem(slug);
        title = cached?.title;
      } catch {
        /* best-effort */
      }
      for (const r of failed) {
        const idx0 = Math.max(0, r.lineIndex - 1);
        const inputLine = (lines[idx0] ?? "").trim();
        if (!inputLine) continue;
        try {
          recordBugReviewFailure({
            titleSlug: slug,
            problemTitle: title,
            language: lang,
            source: "examples",
            input: inputLine,
            expected: r.expected ?? "",
            actual: r.actual ?? "",
            sourceSnippet: sliceSourceSnippet(doc.getText(), r.lineIndex),
            fullSource: doc.getText(),
          });
        } catch (e) {
          Logger.logError("bug-review record failed", e);
        }
      }
      refreshBugReviewStatusBar();
    })();
  };

  const handleBugReviewScratchResults = (
    fsPath: string,
    results: ExampleResult[]
  ): BugReview | undefined => {
    const id = parseBugReviewIdFromPath(fsPath);
    if (!id) return undefined;
    if (results.length === 0) return undefined;
    const allPass = results.every((r) => r.pass);
    const updated = allPass ? advanceBugReviewOnPass(id) : lapseBugReviewOnFail(id);
    refreshBugReviewStatusBar();
    if (updated && allPass) {
      vscode.window.setStatusBarMessage(
        `lcex bug-review: nailed it — next due in ${updated.intervalDays} days`,
        7000
      );
    } else if (updated) {
      vscode.window.setStatusBarMessage(
        `lcex bug-review: still wrong — resurfacing in 3 days (lapses: ${updated.lapseCount})`,
        7000
      );
    }
    return updated;
  };

  const FEATURE_FOOTER = (label: string, toggleCmd: string) =>
    `\n\n[turn off ${label}](command:${toggleCmd}) · [hide all](command:leetcode-practice.toggleInlineDecorations)`;

  writeHintLadderContext = async (slugHint?: string): Promise<string | null> => {
    try {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) return null;
      const lang = languageFromFileExtension(ext) ?? "typescript";
      const source = editor.document.getText();
      if (!source.trim()) return null;
      const slug = slugHint ?? resolveSlugForUri(uri);
      const estimate = estimateLoopNesting(source, lang);
      const ctx: {
        slug: string;
        language: string;
        writtenAt: string;
        staticComplexity: { bigO: string; depth: number; confidence: string; hasLogFactor: boolean };
        topHotspot?: { line: number; label: string; contributesO: string };
        constraints?: { primaryN: number; targetLabel: string };
        verdict?: { tone: string; estimateLabel: string };
      } = {
        slug,
        language: lang,
        writtenAt: new Date().toISOString(),
        staticComplexity: {
          bigO: estimate.bigO,
          depth: estimate.maxDepth,
          confidence: estimate.confidence,
          hasLogFactor: estimate.hasLogFactor,
        },
      };
      const topHotspot = estimate.hotspots[0];
      if (topHotspot) {
        ctx.topHotspot = {
          line: topHotspot.line,
          label: topHotspot.label,
          contributesO: topHotspot.contributesO,
        };
      }
      try {
        const problem = await getCachedProblem(slug);
        if (problem?.content) {
          const constraints = parseProblemConstraints(problem.content);
          const budget = deriveBudget(constraints);
          if (budget) {
            ctx.constraints = { primaryN: budget.maxSize, targetLabel: budget.targetLabel };
          }
          const verdict = compareToBudget(estimate, budget);
          ctx.verdict = { tone: verdict.tone, estimateLabel: verdict.estimateLabel };
        }
      } catch {
        /* best-effort */
      }
      const dir = path.join(require("os").homedir(), ".lcex", "hint-context");
      fs.mkdirSync(dir, { recursive: true });
      const ctxPath = path.join(dir, `${slug}.json`);
      fs.writeFileSync(ctxPath, JSON.stringify(ctx, null, 2), "utf-8");
      return ctxPath;
    } catch {
      return null;
    }
  };

  refreshBugReviewStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openNextBugReview", async () => {
      if (!isBugReviewEnabled()) {
        vscode.window.showInformationMessage(
          "lcex: bug-review queue is disabled. Enable `leetcodePractice.bugReview.enabled` in settings to use it."
        );
        return;
      }
      const due = listDueReviews();
      if (due.length === 0) {
        vscode.window.setStatusBarMessage("lcex: no bug reviews due — nothing to drill", 5000);
        return;
      }
      const next = due[0];
      const fileExt = (() => {
        switch (next.language) {
          case "javascript": return ".js";
          case "python": return ".py";
          case "cpp": return ".cpp";
          case "java": return ".java";
          default: return ".ts";
        }
      })();
      try {
        fs.mkdirSync(BUG_REVIEW_SCRATCH_DIR, { recursive: true });
        const scratchPath = bugReviewScratchPath(next.id, fileExt);
        const dueLabel = new Date(next.nextDueAt).toLocaleDateString();
        const header =
          next.language === "python"
            ? `# lcex bug-review · ${next.problemTitle ?? next.titleSlug}\n# Failed ${next.failedAt.slice(0, 10)} · interval ${next.intervalDays}d · lapses ${next.lapseCount} · due ${dueLabel}\n# Reproduce the bug, fix it, then run examples (Cmd+Shift+P → "lcex: Run Examples").\n\n`
            : `// lcex bug-review · ${next.problemTitle ?? next.titleSlug}\n// Failed ${next.failedAt.slice(0, 10)} · interval ${next.intervalDays}d · lapses ${next.lapseCount} · due ${dueLabel}\n// Reproduce the bug, fix it, then run examples (Cmd+Shift+P → "lcex: Run Examples").\n\n`;
        const body = next.fullSource && next.fullSource.length > 0
          ? next.fullSource
          : `${next.sourceSnippet}\n${next.input}`;
        if (!fs.existsSync(scratchPath)) {
          fs.writeFileSync(scratchPath, header + body, "utf-8");
        }
        const docu = await vscode.workspace.openTextDocument(scratchPath);
        await vscode.window.showTextDocument(docu, { preview: false });
      } catch (e) {
        Logger.logError("openNextBugReview failed", e);
        vscode.window.showErrorMessage(
          `lcex: could not open bug review — ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  const COMPLEXITY_RANK: Record<ComplexityClass, number> = {
    "O(1)": 0,
    "O(log n)": 1,
    "O(√n)": 2,
    "O(n)": 3,
    "O(n log n)": 4,
    "O(n²)": 5,
    "O(n³)": 6,
    "O(2ⁿ)": 7,
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.measureComplexity", async () => {
      if (!isEmpiricalFitEnabled()) {
        vscode.window.showInformationMessage(
          "lcex: complexity fitter is disabled. Enable `leetcodePractice.empiricalFit.enabled` and define `function benchmark(n)` (or `def benchmark(n)`) that runs your solution at problem size n."
        );
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage("lcex: open a solution file to measure complexity", 5000);
        return;
      }
      const lang = languageFromFileExtension(ext) ?? "typescript";
      if (lang === "cpp" || lang === "java") {
        const label = lang === "cpp" ? "C++" : "Java";
        vscode.window.setStatusBarMessage(`lcex: complexity fitter doesn't support ${label} yet`, 5000);
        return;
      }
      if (editor.document.isDirty) await editor.document.save();
      clearInlineDecorations(editor, "lcex.fit");
      const slug = resolveSlugForUri(uri);
      try {
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: "lcex: measuring complexity…" },
          () => runEmpiricalFit({ source: editor.document.getText(), lang, slug })
        );
        const source = editor.document.getText();
        const idx = source.split("\n").findIndex((l) => /\bbenchmark\s*\(/.test(l));
        const anchorLine = idx >= 0 ? idx : 0;
        if (!outcome.ok) {
          applyInlineDecorations(editor, "lcex.fit", [
            {
              line: anchorLine,
              text: `  ⚠ fit: ${outcome.message}`,
              severity: "warning",
              hoverMarkdown: `**lcex empirical fit**\n\n${outcome.message}`,
            },
          ]);
          vscode.window.setStatusBarMessage(`lcex fit: ${outcome.message}`, 8000);
          return;
        }
        const staticEstimate = estimateLoopNesting(source, lang);
        const empiricalRank = outcome.bestFit ? COMPLEXITY_RANK[outcome.bestFit] : -1;
        const staticRank = (() => {
          const o = staticEstimate.bigO;
          if (/n³/.test(o)) return COMPLEXITY_RANK["O(n³)"];
          if (/n²/.test(o)) return COMPLEXITY_RANK["O(n²)"];
          if (/n log n/.test(o)) return COMPLEXITY_RANK["O(n log n)"];
          if (/2\^n|2ⁿ/.test(o)) return COMPLEXITY_RANK["O(2ⁿ)"];
          if (/log n|log\(/.test(o)) return COMPLEXITY_RANK["O(log n)"];
          if (/^O\(1\)/.test(o)) return COMPLEXITY_RANK["O(1)"];
          return COMPLEXITY_RANK["O(n)"];
        })();
        const exceeds = empiricalRank > staticRank;
        const tableRows = outcome.measurements
          .map((m) => `| ${m.n} | ${m.ms.toFixed(2)} ms |`)
          .join("\n");
        const ranking = (outcome.ranking ?? [])
          .slice(0, 4)
          .map((r) => `${r.cls} (rss=${r.rss.toFixed(2)})`)
          .join(" · ");
        const verdict = exceeds
          ? `🔴 empirical \`${outcome.bestFit}\` exceeds static \`${staticEstimate.bigO}\` — likely a hidden cost (e.g. \`indexOf\` inside loop, accidental copy)`
          : `🟢 empirical \`${outcome.bestFit}\` matches static \`${staticEstimate.bigO}\``;
        applyInlineDecorations(editor, "lcex.fit", [
          {
            line: anchorLine,
            text: `  📐 fit: ${outcome.bestFit}${exceeds ? ` (exceeds static ${staticEstimate.bigO})` : ""}`,
            severity: exceeds ? "error" : "muted",
            hoverMarkdown:
              `**lcex empirical complexity fit**\n\n${verdict}\n\n| n | t |\n|---|---|\n${tableRows}\n\n**top candidates:** ${ranking}`,
          },
        ]);
        vscode.window.setStatusBarMessage(
          `lcex fit: ${outcome.bestFit}${exceeds ? ` (exceeds static ${staticEstimate.bigO})` : ""}`,
          8000
        );
      } catch (e) {
        Logger.logError("measureComplexity failed", e);
        vscode.window.showErrorMessage(
          `lcex fit failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.visualizeRecursion", async () => {
      if (!isRecursionTreeEnabled()) {
        vscode.window.showInformationMessage(
          "lcex: recursion visualizer is disabled. Enable `leetcodePractice.recursionTree.enabled` and define `traceCall()` (or `trace_call()` in Python) that invokes your recursive function once."
        );
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage("lcex: open a solution file to visualize recursion", 5000);
        return;
      }
      const lang = languageFromFileExtension(ext) ?? "typescript";
      if (lang === "cpp" || lang === "java") {
        const label = lang === "cpp" ? "C++" : "Java";
        vscode.window.setStatusBarMessage(`lcex: recursion visualizer doesn't support ${label} yet`, 5000);
        return;
      }
      if (editor.document.isDirty) await editor.document.save();
      const slug = resolveSlugForUri(uri);
      try {
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: "lcex: tracing recursion…" },
          () => runRecursionTrace({ source: editor.document.getText(), lang, slug })
        );
        if (!outcome.ok) {
          vscode.window.showWarningMessage(`lcex recursion: ${outcome.message}`);
          return;
        }
        const panel = vscode.window.createWebviewPanel(
          "lcexRecursionTree",
          `🌳 ${outcome.fn ?? "recursion"} · ${slug}`,
          vscode.ViewColumn.Beside,
          { enableScripts: false, retainContextWhenHidden: true }
        );
        panel.webview.html = renderRecursionTreeHtml(outcome);
        vscode.window.setStatusBarMessage(`lcex recursion: ${outcome.message}`, 6000);
      } catch (e) {
        Logger.logError("visualizeRecursion failed", e);
        vscode.window.showErrorMessage(
          `lcex recursion failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.visualizeIterative", async () => {
      if (!isIterativeVisualizerEnabled()) {
        vscode.window.showInformationMessage(
          "lcex: iterative visualizer is disabled. Enable `leetcodePractice.iterativeVisualizer.enabled` and define `traceCall()` (or `trace_call()` in Python) that calls `lcexTrace.track(container, \"stack\"|\"queue\")` and runs the loop."
        );
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage("lcex: open a solution file to visualize iterative traversal", 5000);
        return;
      }
      const lang = languageFromFileExtension(ext) ?? "typescript";
      if (lang === "cpp" || lang === "java") {
        const label = lang === "cpp" ? "C++" : "Java";
        vscode.window.setStatusBarMessage(`lcex: iterative visualizer doesn't support ${label} yet`, 5000);
        return;
      }
      if (editor.document.isDirty) await editor.document.save();
      const slug = resolveSlugForUri(uri);
      try {
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: "lcex: tracing traversal…" },
          () => runIterativeTrace({ source: editor.document.getText(), lang, slug })
        );
        if (!outcome.ok) {
          vscode.window.showWarningMessage(`lcex iterative: ${outcome.message}`);
          return;
        }
        const panel = vscode.window.createWebviewPanel(
          "lcexIterativeTree",
          `🧭 ${outcome.fn ?? "traversal"} · ${slug}`,
          vscode.ViewColumn.Beside,
          { enableScripts: false, retainContextWhenHidden: true }
        );
        panel.webview.html = renderIterativeTreeHtml(outcome);
        vscode.window.setStatusBarMessage(`lcex iterative: ${outcome.message}`, 6000);
      } catch (e) {
        Logger.logError("visualizeIterative failed", e);
        vscode.window.showErrorMessage(
          `lcex iterative failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.fuzzVsBruteForce", async () => {
      if (!isFuzzerEnabled()) {
        vscode.window.showInformationMessage(
          "lcex: fuzzer is disabled. Enable `leetcodePractice.fuzzer.enabled` in settings, then add `bruteForce` and `fuzzInputs` (or `brute_force`/`fuzz_inputs` in Python) functions alongside your solution."
        );
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage("lcex: open a solution file to fuzz", 5000);
        return;
      }
      const lang = languageFromFileExtension(ext) ?? "typescript";
      if (lang === "cpp" || lang === "java") {
        const label = lang === "cpp" ? "C++" : "Java";
        vscode.window.setStatusBarMessage(`lcex: fuzzer doesn't support ${label} yet`, 5000);
        return;
      }
      if (editor.document.isDirty) await editor.document.save();
      clearInlineDecorations(editor, "lcex.fuzz");
      const slug = resolveSlugForUri(uri);
      try {
        const outcome = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: "lcex: fuzzing vs brute-force…" },
          () => runFuzz({ source: editor.document.getText(), lang, slug })
        );
        const blocks = parseExampleBlocks(editor.document.getText(), lang);
        const anchorLine = blocks[0]?.callLine ? blocks[0].callLine - 1 : 0;
        if (outcome.ok) {
          applyInlineDecorations(editor, "lcex.fuzz", [
            {
              line: anchorLine,
              text: `  🎲 fuzz: ${outcome.message}`,
              severity: "muted",
              hoverMarkdown: `**lcex fuzz**\n\n${outcome.message}`,
            },
          ]);
          vscode.window.setStatusBarMessage(`lcex fuzz: ${outcome.message}`, 6000);
        } else if (outcome.counterexample) {
          const ce = outcome.counterexample;
          applyInlineDecorations(editor, "lcex.fuzz", [
            {
              line: anchorLine,
              text: `  ❌ fuzz counterexample (iter ${ce.iter})`,
              severity: "error",
              hoverMarkdown:
                `**lcex fuzz · counterexample**\n\n- args: \`${ce.argsJson}\`\n- user output: \`${ce.userOut}\`\n- bruteForce output: \`${ce.bruteOut}\`\n- iteration: ${ce.iter} of ${outcome.ranCases}`,
            },
          ]);
          vscode.window.setStatusBarMessage(
            `lcex fuzz: counterexample at iter ${ce.iter} — hover for details`,
            10000
          );
          if (isBugReviewEnabled()) {
            try {
              let title: string | undefined;
              try { const cached = await getCachedProblem(slug); title = cached?.title; } catch { /* best-effort */ }
              const { recordFailure } = await import("./modules/BugReviewStore");
              recordFailure({
                titleSlug: slug,
                problemTitle: title,
                language: lang,
                source: "fuzzer",
                input: ce.argsJson,
                expected: ce.bruteOut,
                actual: ce.userOut,
                sourceSnippet: editor.document.getText(),
                fullSource: editor.document.getText(),
              });
              refreshBugReviewStatusBar();
            } catch (e) {
              Logger.logError("fuzz: bug-review record failed", e);
            }
          }
        } else {
          applyInlineDecorations(editor, "lcex.fuzz", [
            {
              line: anchorLine,
              text: `  ⚠ fuzz: ${outcome.message}`,
              severity: "warning",
              hoverMarkdown: `**lcex fuzz**\n\n${outcome.message}`,
            },
          ]);
          vscode.window.setStatusBarMessage(`lcex fuzz: ${outcome.message}`, 8000);
        }
      } catch (e) {
        Logger.logError("fuzz failed", e);
        vscode.window.showErrorMessage(
          `lcex fuzz failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.clearInlineDecorations", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        clearInlineDecorations(editor);
      } else {
        clearAllInlineDecorations();
      }
      lintDiagnostics.clear();
      vscode.window.setStatusBarMessage("lcex: inline decorations cleared", 2500);
    })
  );

  const severityToDiagnostic = (s: "warning" | "info"): vscode.DiagnosticSeverity =>
    s === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;

  const runLintOn = (doc: vscode.TextDocument): LintFinding[] => {
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    if (!SOLUTION_FILE_EXTENSIONS.includes(ext)) {
      lintDiagnostics.delete(doc.uri);
      return [];
    }
    const lang = languageFromFileExtension(ext) ?? "typescript";
    const findings = lintSolutionSource(doc.getText(), lang);
    const diags = findings.map((f) => {
      const d = new vscode.Diagnostic(
        new vscode.Range(f.line, f.column, f.line, f.endColumn),
        f.message,
        severityToDiagnostic(f.severity)
      );
      d.source = "lcex-lint";
      d.code = f.rule;
      return d;
    });
    lintDiagnostics.set(doc.uri, diags);
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === doc.uri.toString()
    );
    if (editor) {
      const items: InlineItem[] = firstFindingPerLine(findings).map((f) => ({
        line: f.line,
        text: `  ${f.inlineHint}`,
        severity: f.severity === "warning" ? "warning" : "info",
        hoverMarkdown:
          `**lcex-lint:${f.rule}**\n\n${f.message}\n\n_Suppress inline with \`// lcex-lint-ignore: ${f.rule}\`._` +
          FEATURE_FOOTER("lint", "leetcode-practice.toggleLint"),
      }));
      applyInlineDecorations(editor, "lcex.lint", items);
    }
    return findings;
  };

  const runComplexityOn = async (
    doc: vscode.TextDocument,
    editor: vscode.TextEditor,
    preFetched: CachedProblem
  ): Promise<void> => {
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    const lang = languageFromFileExtension(ext) ?? "typescript";
    const source = doc.getText();
    const estimate = estimateLoopNesting(source, lang);
    const sigLine = findSignatureLine(source, lang);
    const problem = preFetched ?? (await getCachedProblem(resolveSlugForUri(doc.uri)));
    const budget = problem ? deriveBudget(parseProblemConstraints(problem.content ?? "")) : null;
    const items: InlineItem[] = buildComplexityInlineItems(sigLine, estimate, budget).map((i) => ({
      line: i.line,
      text: i.text,
      severity: i.severity,
      hoverMarkdown:
        (i.hoverMarkdown ?? "") +
        FEATURE_FOOTER("complexity budget", "leetcode-practice.toggleComplexityBudget"),
    }));
    applyInlineDecorations(editor, "lcex.complexity", items);
  };

  const runAdversarialOn = async (
    doc: vscode.TextDocument,
    editor: vscode.TextEditor,
    preFetched: CachedProblem
  ): Promise<void> => {
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    const lang = languageFromFileExtension(ext) ?? "typescript";
    const problem = preFetched ?? (await getCachedProblem(resolveSlugForUri(doc.uri)));
    if (!problem) {
      applyInlineDecorations(editor, "lcex.adversarial", [
        {
          line: 0,
          text: "  ⓘ could not resolve problem — open it from the sidebar first",
          severity: "warning",
          hoverMarkdown:
            "lcex: could not fetch problem to parse constraints. Open the problem from the sidebar first so the URI mapping is cached." +
            FEATURE_FOOTER("edge-case probes", "leetcode-practice.toggleAdversarialTests"),
        },
      ]);
      return;
    }
    const sigLine = findSignatureLine(doc.getText(), lang);
    const summary = buildAdversarialSummary(problem.content ?? "");
    applyInlineDecorations(editor, "lcex.adversarial", [
      {
        line: sigLine,
        text: summary.signatureLine,
        severity: summary.perCase.length === 0 ? "muted" : "warning",
        hoverMarkdown:
          summary.signatureHover +
          FEATURE_FOOTER("edge-case probes", "leetcode-practice.toggleAdversarialTests"),
      },
    ]);
  };

  const runExamplesOn = async (
    doc: vscode.TextDocument,
    editor: vscode.TextEditor
  ): Promise<void> => {
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    const lang = languageFromFileExtension(ext) ?? "typescript";
    clearInlineDecorations(editor, "lcex.runExamples");
    const footer = FEATURE_FOOTER("on-save runs", "leetcode-practice.toggleRunExamplesOnSave");
    try {
      const results = await runExamplesImpl(doc.uri);
      if (results.length === 0) return;
      const items: InlineItem[] = results.map((r) => {
        const line = Math.max(0, r.lineIndex - 1);
        if (r.pass) {
          const tail = r.expected === null ? ` → ${r.actual}` : "  ✓";
          return {
            line,
            text: tail,
            severity: r.expected === null ? "muted" : "success",
            hoverMarkdown:
              `**lcex: example passed**\n\n- actual: \`${r.actual || "(empty)"}\`${r.expected !== null ? `\n- expected: \`${r.expected}\`` : ""}` +
              footer,
          };
        }
        return {
          line,
          text: `  ✗ expected ${r.expected ?? "?"} · got ${r.actual || "∅"}`,
          severity: "error",
          hoverMarkdown:
            `**lcex example failed**\n\n- expected: \`${r.expected ?? "?"}\`\n- got: \`${r.actual || "(empty)"}\`` +
            footer,
        };
      });
      applyInlineDecorations(editor, "lcex.runExamples", items);
      if (!handleBugReviewScratchResults(doc.uri.fsPath, results)) {
        recordBugReviewsFromExampleResults(doc, results);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /\b(ETIMEDOUT|SIGTERM|SIGKILL|timeout|timed out|killed)\b/i.test(msg);
      const blocks = parseExampleBlocks(doc.getText(), lang);
      const firstBlockLine = blocks[0]?.callLine ? blocks[0].callLine - 1 : 0;
      const label = isTimeout ? "✗ timeout (>15s)" : "✗ runtime error";
      applyInlineDecorations(editor, "lcex.runExamples", [
        {
          line: firstBlockLine,
          text: `  ${label} — hover for details`,
          severity: "error",
          hoverMarkdown:
            (isTimeout
              ? `**lcex: execution timed out**\n\nExceeded 15 seconds.\n\n\`\`\`\n${msg}\n\`\`\``
              : `**lcex: execution failed**\n\n\`\`\`\n${msg}\n\`\`\``) +
            footer,
        },
      ]);
    }
  };

  const runAllFeaturesOn = async (doc: vscode.TextDocument): Promise<void> => {
    if (!isInlineEnabled()) return;
    const ext = path.extname(doc.uri.fsPath).toLowerCase();
    if (!SOLUTION_FILE_EXTENSIONS.includes(ext)) return;
    const editor = vscode.window.visibleTextEditors.find(
      (v) => v.document.uri.toString() === doc.uri.toString()
    );
    if (!editor) return;

    const needsProblem = isComplexityEnabled() || isAdversarialEnabled();
    const problem: CachedProblem = needsProblem
      ? await getCachedProblem(resolveSlugForUri(doc.uri))
      : null;

    if (isLintEnabled()) runLintOn(doc);
    if (isComplexityEnabled()) await runComplexityOn(doc, editor, problem);
    if (isAdversarialEnabled()) await runAdversarialOn(doc, editor, problem);
    if (isRunExamplesOnSaveEnabled()) void runExamplesOn(doc, editor);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.complexityBudget", async () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage(
          "lcex: open a .ts/.js/.py/.cpp/.java solution file for a complexity budget",
          5000
        );
        return;
      }
      await runComplexityOn(editor.document, editor, null);
    }),
    vscode.commands.registerCommand("leetcode-practice.runAdversarialTests", async () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      const ext = uri ? path.extname(uri.fsPath).toLowerCase() : "";
      if (!editor || !uri || !SOLUTION_FILE_EXTENSIONS.includes(ext)) {
        vscode.window.setStatusBarMessage(
          "lcex: open a .ts/.js/.py/.cpp/.java solution file for adversarial probes",
          5000
        );
        return;
      }
      await runAdversarialOn(editor.document, editor, null);
    }),
    vscode.commands.registerCommand("leetcode-practice.lint", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.setStatusBarMessage("lcex: no active editor to lint", 4000);
        return;
      }
      const findings = runLintOn(editor.document);
      vscode.window.setStatusBarMessage(
        findings.length === 0
          ? "lcex: lint — no issues ✓"
          : `lcex: lint — ${findings.length} issue${findings.length === 1 ? "" : "s"}`,
        6000
      );
    })
  );

  const makeToggle = (
    configKey: string,
    label: string,
    decorationId: string,
    defaultValue: boolean,
    clearDiagsToo: boolean = false
  ) => async () => {
    const current = cfg(configKey, defaultValue);
    await setCfg(configKey, !current);
    if (current) {
      for (const ed of vscode.window.visibleTextEditors) {
        clearInlineDecorations(ed, decorationId);
      }
      if (clearDiagsToo) lintDiagnostics.clear();
    } else if (vscode.window.activeTextEditor) {
      void runAllFeaturesOn(vscode.window.activeTextEditor.document);
    }
    vscode.window.setStatusBarMessage(`lcex: ${label} ${!current ? "enabled" : "disabled"}`, 4000);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.toggleLint",
      makeToggle("lint.enabled", "lint", "lcex.lint", true, true)
    ),
    vscode.commands.registerCommand(
      "leetcode-practice.toggleComplexityBudget",
      makeToggle("complexityBudget.enabled", "complexity budget", "lcex.complexity", true)
    ),
    vscode.commands.registerCommand(
      "leetcode-practice.toggleAdversarialTests",
      makeToggle("adversarialTests.enabled", "edge-case probes", "lcex.adversarial", false)
    ),
    vscode.commands.registerCommand(
      "leetcode-practice.toggleRunExamplesOnSave",
      makeToggle("runExamplesOnSave.enabled", "run examples on save", "lcex.runExamples", true)
    ),
    vscode.commands.registerCommand("leetcode-practice.toggleInlineDecorations", async () => {
      const current = isInlineEnabled();
      await setCfg("inlineDecorations.enabled", !current);
      if (current) {
        for (const ed of vscode.window.visibleTextEditors) {
          clearInlineDecorations(ed);
        }
        lintDiagnostics.clear();
      } else if (vscode.window.activeTextEditor) {
        void runAllFeaturesOn(vscode.window.activeTextEditor.document);
      }
      vscode.window.setStatusBarMessage(
        `lcex: inline decorations ${!current ? "enabled" : "disabled"}`,
        4000
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void runAllFeaturesOn(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      lintDiagnostics.delete(doc.uri);
      problemCache.delete(resolveSlugForUri(doc.uri));
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ext = path.extname(e.document.uri.fsPath).toLowerCase();
      if (!SOLUTION_FILE_EXTENSIONS.includes(ext)) return;
      lintDiagnostics.delete(e.document.uri);
      const ed = vscode.window.visibleTextEditors.find(
        (v) => v.document.uri.toString() === e.document.uri.toString()
      );
      if (ed) {
        clearInlineDecorations(ed, "lcex.lint");
        clearInlineDecorations(ed, "lcex.runExamples");
        clearInlineDecorations(ed, "lcex.complexity");
        clearInlineDecorations(ed, "lcex.adversarial");
      }
    })
  );

  if (vscode.window.activeTextEditor) {
    void runAllFeaturesOn(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.runInTerminal", () => {
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      const ext = filePath ? path.extname(filePath) : "";
      if (!filePath || !SOLUTION_FILE_EXTENSIONS.includes(ext.toLowerCase())) {
        vscode.window.showWarningMessage(
          "Open a supported solution file (.ts, .js, .py, .cpp, .java) to run."
        );
        return;
      }
      trackAnalytics("run_in_terminal", "command_palette", "run_in_terminal", {
        language: bucketLanguage(ext.replace(".", "")),
      });
      runTsNodeInTerminal(filePath);
    })
  );

  const globalState = context.globalState;
  const storagePath = context.globalStorageUri.fsPath;
  const fileDecorationProvider = new LeetCodeFileDecorationProvider(storagePath);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileDecorationProvider));
  const problemsProvider = new ProblemsTreeProvider("problemset", globalState, storagePath);
  const treeView = vscode.window.createTreeView(
    "leetcode-practice.problemsView",
    { treeDataProvider: problemsProvider }
  );
  const getProblemStatus = (slug: string) => getStoredStatus(globalState, slug);

  treeView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as ProblemTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
  });
  context.subscriptions.push(treeView);

  const STUDY_PLANS_KEY = "leetcode-practice.selectedStudyPlan";
  const PROBLEM_LIST_KEY = "leetcode-practice.selectedProblemList";

  const folders = vscode.workspace.workspaceFolders ?? [];
  const leetcodeConfig = getEffectiveConfig(folders);
  const studyPlansConfig = leetcodeConfig.studyPlans ?? [
    { slug: "top-interview-150", name: "Top Interview 150" },
  ];
  const problemListsConfig = leetcodeConfig.problemLists ?? [];

  const workspaceStudySlug = context.workspaceState.get<string>(STUDY_PLANS_KEY)?.trim();
  const savedStudySlug =
    workspaceStudySlug && studyPlansConfig.some((p) => p.slug === workspaceStudySlug)
      ? workspaceStudySlug
      : resolveDefaultStudyPlanSlug(studyPlansConfig, leetcodeConfig.activeStudyPlan);

  const workspaceProblemSlug = context.workspaceState.get<string>(PROBLEM_LIST_KEY)?.trim();
  const savedProblemSlug =
    workspaceProblemSlug && problemListsConfig.some((p) => p.slug === workspaceProblemSlug)
      ? workspaceProblemSlug
      : resolveDefaultProblemListSlug(problemListsConfig, leetcodeConfig.activeProblemList, {
          activeStudyPlan: leetcodeConfig.activeStudyPlan,
          activeListSource: leetcodeConfig.activeListSource,
        });

  if (workspaceStudySlug && workspaceStudySlug !== savedStudySlug) {
    void context.workspaceState.update(STUDY_PLANS_KEY, savedStudySlug);
  }
  if (workspaceProblemSlug && workspaceProblemSlug !== savedProblemSlug) {
    void context.workspaceState.update(PROBLEM_LIST_KEY, savedProblemSlug);
  }

  const problemListLabel =
    problemListsConfig.find((p) => p.slug === savedProblemSlug)?.name ?? undefined;

  const getCookie = () => Database.getSession(context)?.cookie?.trim() || undefined;

  const studyPlanProvider = new ProblemsTreeProvider(savedStudySlug, globalState, storagePath, {
    initialListSource: "studyPlan",
    getCookie,
  });

  const problemListProvider = new ProblemsTreeProvider(savedProblemSlug, globalState, storagePath, {
    initialListSource: "problemList",
    problemListCategoryLabel: problemListLabel,
    getCookie,
  });

  const topInterview150View = vscode.window.createTreeView(
    "leetcode-practice.topInterview150View",
    { treeDataProvider: studyPlanProvider }
  );
  topInterview150View.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as ProblemTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
  });
  context.subscriptions.push(topInterview150View);

  const problemListsView = vscode.window.createTreeView("leetcode-practice.problemListsView", {
    treeDataProvider: problemListProvider,
  });
  problemListsView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as ProblemTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
  });
  context.subscriptions.push(problemListsView);

  const QOTD_CACHE_PATH = path.join(context.globalStorageUri.fsPath, "qotd-cache.json");
  Logger.log(`QOTD cache path: ${QOTD_CACHE_PATH}`);
  const QOTD_MONTHS = 6;
  const todayStr = () => new Date().toISOString().slice(0, 10);

  class QotdTreeItem extends vscode.TreeItem {
    constructor(
      public readonly item: ProblemListItem,
      label: string,
      status: ReturnType<typeof getStoredStatus>
    ) {
      super(label, vscode.TreeItemCollapsibleState.None);
      this.tooltip = item.titleSlug;
      const statusSuffix =
        status === "solved" ? " • ✓" : status === "attempting" ? " • Attempting" : "";
      this.description = `${item.difficulty}${statusSuffix}`;
      if (status === "solved") {
        this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
      } else if (status === "attempting") {
        this.iconPath = new vscode.ThemeIcon("debug-start", new vscode.ThemeColor("editorWarning.foreground"));
      }
    }
  }

  class QotdTreeProvider implements vscode.TreeDataProvider<QotdTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private leetcode = new LeetCodeProvider();

    private async fetchAndSave(): Promise<void> {
      const today = todayStr();
      const todaySlug = await this.leetcode.questionOfToday();
      const entries: DailyChallengeEntry[] = [];
      const now = new Date();
      for (let i = 0; i < QOTD_MONTHS; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const page = await this.leetcode.getDailyChallengeList(d.getFullYear(), d.getMonth() + 1);
        entries.push(...page);
      }
      const seen = new Set<string>();
      const merged: DailyChallengeEntry[] = [];
      if (todaySlug) {
        const todayEntry = entries.find((e) => e.date === today && e.titleSlug === todaySlug);
        if (todayEntry) {
          merged.push(todayEntry);
          seen.add(todayEntry.date);
        } else {
          merged.push({
            id: "?",
            titleSlug: todaySlug,
            title: "Today's challenge",
            date: today,
          });
          seen.add(today);
        }
      }
      const rest = entries
        .filter((e) => !seen.has(e.date))
        .sort((a, b) => (b.date > a.date ? 1 : -1));
      merged.push(...rest);
      fs.mkdirSync(path.dirname(QOTD_CACHE_PATH), { recursive: true });
      fs.writeFileSync(QOTD_CACHE_PATH, JSON.stringify(merged), "utf-8");
      Logger.log(`QOTD cache written: ${QOTD_CACHE_PATH} (${merged.length} entries)`);
    }

    invalidate(): void {
      this._onDidChangeTreeData.fire();
    }

    async refresh(): Promise<void> {
      await this.fetchAndSave();
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QotdTreeItem): vscode.TreeItem {
      return element;
    }

    async getChildren(): Promise<QotdTreeItem[]> {
      let cached: DailyChallengeEntry[] = [];
      try {
        const exists = fs.existsSync(QOTD_CACHE_PATH);
        Logger.log(`QOTD cache read: ${QOTD_CACHE_PATH} exists=${exists}`);
        if (exists) {
          const raw = fs.readFileSync(QOTD_CACHE_PATH, "utf-8");
          cached = JSON.parse(raw) as DailyChallengeEntry[];
          Logger.log(`QOTD cache loaded ${cached.length} entries`);
        }
      } catch (e) {
        Logger.logError("QOTD cache read failed", e);
        cached = [];
      }
      if (!cached || cached.length === 0) {
        await this.fetchAndSave();
        try {
          if (fs.existsSync(QOTD_CACHE_PATH)) {
            const raw = fs.readFileSync(QOTD_CACHE_PATH, "utf-8");
            cached = JSON.parse(raw) as DailyChallengeEntry[];
          }
        } catch {
          cached = [];
        }
      }
      if (!cached || cached.length === 0) {
        return [];
      }
      const today = todayStr();
      return cached.map((e) => {
        const label = e.date === today ? `Today: ${e.title}` : `${e.date}: ${e.title}`;
        const item: ProblemListItem = {
          id: e.id,
          titleSlug: e.titleSlug,
          title: e.title,
          difficulty: "Unknown",
        };
        return new QotdTreeItem(item, label, getStoredStatus(globalState, e.titleSlug));
      });
    }
  }

  const qotdProvider = new QotdTreeProvider();
  const qotdView = vscode.window.createTreeView("leetcode-practice.qotdView", {
    treeDataProvider: qotdProvider,
  });
  const contestsProvider = new ContestsTreeProvider(storagePath, globalState);
  const contestsView = vscode.window.createTreeView("leetcode-practice.contestsView", {
    treeDataProvider: contestsProvider,
  });
  if (contestsView.visible) contestsProvider.startCountdownTimer();
  contestsView.onDidChangeVisibility((e) => {
    if (e.visible) contestsProvider.startCountdownTimer();
    else contestsProvider.stopCountdownTimer();
  });
  contestsView.onDidChangeSelection(async (e) => {
    const item = e.selection[0];
    if (item instanceof ContestProblemTreeItem) {
      // Plain open — never auto-start; the setup panel is the only entry point for contest interviews.
      await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
      return;
    }
    if (item instanceof PastContestItem) {
      const contest = item.contest;
      const problems = await vscode.window.withProgress(
        { location: { viewId: "leetcode-practice.contestsView" }, title: "Loading contest problems…" },
        () => contestsProvider.getContestProblems(contest.titleSlug)
      );
      openContestSetupWebview(context, contest, problems, {
        onStart: async (slug) => {
          if (slug !== contest.titleSlug) {
            return { ok: false, message: "Contest mismatch." };
          }
          if (problems.length === 0) {
            return { ok: false, message: "No problems found for this contest." };
          }
          const planned: PlannedInterviewProblem[] = problems.map((p) => ({
            titleSlug: p.titleSlug,
            difficulty: (p.difficulty || "MEDIUM").toUpperCase(),
          }));
          const folders = vscode.workspace.workspaceFolders ?? [];
          const root = folders[0]?.uri.fsPath;
          const solutionFolderPath = root
            ? path.join(root, "contests", sanitizeInterviewDirectoryName(contest.titleSlug))
            : path.join(context.globalStorageUri.fsPath, "contests", sanitizeInterviewDirectoryName(contest.titleSlug));
          try {
            fs.mkdirSync(solutionFolderPath, { recursive: true });
          } catch (err) {
            return {
              ok: false,
              message: `Could not create contest folder: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
          let attemptHex: string;
          try {
            attemptHex = generateUniqueAttemptHex([], solutionFolderPath);
          } catch {
            return { ok: false, message: "Could not allocate a unique attempt id." };
          }
          const durationMinutes = Math.max(1, Math.round(contest.duration / 60));
          return runInterviewSessionAfterPlan(context, getWebviewOpts, {
            durationMinutes,
            planned,
            interviewName: contest.title,
            kind: "contest",
            solutionFolderPath,
            attemptHex,
          });
        },
        onOpenProblem: async (titleSlug: string) => {
          const peek = problems.find((p) => p.titleSlug === titleSlug) ?? {
            id: titleSlug,
            title: titleSlug,
            titleSlug,
            difficulty: "Unknown",
          };
          await openProblemWebview(context, peek, getProvider, getProblemStatus, getWebviewOpts());
        },
      });
    }
  });
  context.subscriptions.push(contestsView, { dispose: () => contestsProvider.dispose() });

  const companiesProvider = new CompaniesTreeProvider(context.extensionPath, globalState);
  const companiesView = vscode.window.createTreeView("leetcode-practice.companiesView", {
    treeDataProvider: companiesProvider,
  });
  companiesView.onDidChangeSelection(async (e) => {
    const item = e.selection[0];
    if (item instanceof CompanyProblemTreeItem) {
      trackAnalytics("command_invoked", "sidebar", "open_company_problem");
      await openProblemWebview(
        context,
        item.item,
        getProvider,
        getProblemStatus,
        getWebviewOpts()
      );
    }
  });
  context.subscriptions.push(companiesView, { dispose: () => companiesProvider.dispose() });

  const patternMasteryProvider = new PatternMasteryTreeProvider(globalState);
  const patternMasteryView = vscode.window.createTreeView("leetcode-practice.patternMasteryView", {
    treeDataProvider: patternMasteryProvider,
  });
  context.subscriptions.push(patternMasteryView);

  function refreshAllProblemViews(): void {
    problemsProvider.invalidate();
    studyPlanProvider.invalidate();
    problemListProvider.invalidate();
    qotdProvider.invalidate();
    contestsProvider.invalidate();
    companiesProvider.invalidate();
    patternMasteryProvider.refresh();
  }
  webviewOptsHolder.current = {
    onMarkSolved: async (titleSlug) => {
      setProblemStatus(globalState, titleSlug, "solved");
      await handleProblemSolved(context, titleSlug, getProvider);
      refreshAllProblemViews();
      void refreshInterviewHubIfOpen(context, getProvider);
    },
    onMarkInterviewSolved: async (titleSlug) => {
      await recordInterviewSolve(globalState, titleSlug);
      await refreshInterviewHubIfOpen(context, getProvider);
    },
  };
  qotdView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as QotdTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
  });
  context.subscriptions.push(qotdView);

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshProblems", async () => {
      trackAnalytics("command_invoked", "command_palette", "refresh_problems");
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing problems..." },
        async () => {
          problemsProvider.refresh();
          studyPlanProvider.refresh();
          problemListProvider.refresh();
          await qotdProvider.refresh();
          await contestsProvider.refresh();
          fileDecorationProvider.invalidate();
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshContests", async () => {
      trackAnalytics("command_invoked", "sidebar", "refresh_contests");
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing contests..." },
        () => contestsProvider.refresh()
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshCompanies", () => {
      trackAnalytics("command_invoked", "sidebar", "refresh_companies");
      companiesProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.searchCompanies", async () => {
      trackAnalytics("command_invoked", "sidebar", "search_companies");
      const query = await vscode.window.showInputBox({
        prompt: "Search companies and problems",
        placeHolder: "e.g. amazon, two sum, dynamic programming",
      });
      if (query === undefined) return;
      companiesProvider.setQueryFilter(query || undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.filterCompaniesByDifficulty", async () => {
      const choice = await vscode.window.showQuickPick(
        ["All", "Easy", "Medium", "Hard"],
        { placeHolder: "Filter company problems by difficulty" }
      );
      if (choice === undefined) return;
      companiesProvider.setDifficultyFilter(choice === "All" ? undefined : choice);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openContestOnWeb", async (item) => {
      trackAnalytics("command_invoked", "sidebar", "open_contest_on_web");
      const slug =
        item instanceof UpcomingContestItem
          ? item.contest.titleSlug
          : item instanceof PastContestItem
            ? item.contest.titleSlug
            : undefined;
      if (!slug) return;
      await vscode.env.openExternal(vscode.Uri.parse(`https://leetcode.com/contest/${slug}/`));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.switchStudyPlan", async () => {
      trackAnalytics("command_invoked", "sidebar", "switch_study_plan");
      const folders = vscode.workspace.workspaceFolders ?? [];
      const cfg = getEffectiveConfig(folders);
      const plans = cfg.studyPlans ?? [{ slug: "top-interview-150", name: "Top Interview 150" }];
      if (plans.length === 0) {
        vscode.window.showInformationMessage(
          "No study plans configured. Add them in leetcodePractice.studyPlans or .leetcode."
        );
        return;
      }
      const choice = await vscode.window.showQuickPick(
        plans.map((p) => ({ label: p.name, slug: p.slug })),
        { placeHolder: "Select study plan" }
      );
      if (!choice) return;
      await context.workspaceState.update(STUDY_PLANS_KEY, choice.slug);
      studyPlanProvider.setPlanSlug(choice.slug);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.switchProblemList", async () => {
      trackAnalytics("command_invoked", "sidebar", "switch_problem_list");
      const folders = vscode.workspace.workspaceFolders ?? [];
      const cfg = getEffectiveConfig(folders);
      const lists = cfg.problemLists ?? [];
      if (lists.length === 0) {
        vscode.window.showInformationMessage(
          "No problem lists configured. Add leetcodePractice.problemLists or problemLists in .leetcode."
        );
        return;
      }
      const choice = await vscode.window.showQuickPick(
        lists.map((p) => ({ label: p.name, slug: p.slug })),
        { placeHolder: "Select problem list" }
      );
      if (!choice) return;
      await context.workspaceState.update(PROBLEM_LIST_KEY, choice.slug);
      problemListProvider.setPlanSlug(choice.slug, choice.label);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshQotd", async () => {
      trackAnalytics("command_invoked", "sidebar", "refresh_qotd");
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing Question of the Day..." },
        () => qotdProvider.refresh()
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.filterByDifficulty", async () => {
      trackAnalytics("command_invoked", "sidebar", "filter_difficulty");
      const choice = await vscode.window.showQuickPick(
        ["All", "Easy", "Medium", "Hard"],
        { placeHolder: "Filter by difficulty" }
      );
      if (choice === undefined) return;
      problemsProvider.setFilter(choice === "All" ? undefined : choice, undefined);
      studyPlanProvider.setFilter(choice === "All" ? undefined : choice, undefined);
      problemListProvider.setFilter(choice === "All" ? undefined : choice, undefined);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.searchProblems", async () => {
      trackAnalytics("command_invoked", "sidebar", "search_problems");
      const query = await vscode.window.showInputBox({
        prompt: "Search by problem title or slug",
        placeHolder: "e.g. two sum",
      });
      if (query === undefined) return;
      problemsProvider.setFilter(undefined, query || undefined);
      studyPlanProvider.setFilter(undefined, query || undefined);
      problemListProvider.setFilter(undefined, query || undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.viewStats", () => {
      trackAnalytics("command_invoked", "command_palette", "view_stats");
      openStatsWebview(context, globalState).catch((e) =>
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e))
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshStatsData", () => {
      refreshStatsData(context, globalState).catch((e) =>
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e))
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.cloudSignIn", async () => {
      trackAnalytics("command_invoked", "command_palette", "cloud_sign_in");
      await signInToCloud(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.cloudSignOut", async () => {
      trackAnalytics("command_invoked", "command_palette", "cloud_sign_out");
      await signOutFromCloud(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.setCloudUsername", async () => {
      trackAnalytics("command_invoked", "command_palette", "set_cloud_username");
      const cfg = vscode.workspace.getConfiguration("leetcodePractice");
      const current = cfg.get<string>("leetcodeUsername") ?? "";
      const value = await vscode.window.showInputBox({
        prompt: "LeetCode username (used as the per-account Firestore document id)",
        value: current,
        validateInput: (s) => {
          const t = s.trim();
          if (!t) return "Enter a non-empty username, or cancel.";
          if (!sanitizeCloudUsername(t)) {
            return "Use only letters, numbers, _, -, . (1–128 characters).";
          }
          return undefined;
        },
      });
      if (value === undefined) return;
      await cfg.update("leetcodeUsername", value.trim(), vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`LeetCode username set to "${value.trim()}".`);
    })
  );

  const warnNotSignedIn = () =>
    vscode.window.showWarningMessage(
      'Sign in to cloud sync first (command "LeetCode: Sign in to Cloud Sync").'
    );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.pushCloudStats", async () => {
      const result = await pushStatsToCloud(context, globalState);
      trackAnalytics("cloud_sync", "command_palette", "push_cloud_stats", {
        result: result.ok ? "ok" : "err",
      });
      if (result.ok) {
        void vscode.window.showInformationMessage("Stats pushed to cloud.");
        return;
      }
      if (result.reason === "not_signed_in") {
        void warnNotSignedIn();
        return;
      }
      if (result.reason === "no_username") {
        void vscode.window.showWarningMessage(
          'Set your LeetCode username first (command "LeetCode: Set LeetCode username").'
        );
        return;
      }
      if (result.reason === "invalid_username") {
        void vscode.window.showWarningMessage(
          "LeetCode username is invalid. Use only letters, numbers, _, -, . (1–128 characters)."
        );
        return;
      }
      if (result.reason === "throttled" && result.nextAllowedAt !== undefined) {
        void vscode.window.showInformationMessage(formatPushWaitMessage(result.nextAllowedAt));
        return;
      }
      if (result.reason === "firestore") {
        void vscode.window.showErrorMessage(`Cloud push failed: ${result.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.pullCloudStats", async () => {
      if (!getCloudIdentity(globalState)) {
        void warnNotSignedIn();
        return;
      }
      const raw = getConfiguredLeetcodeUsername();
      const id = sanitizeCloudUsername(raw);
      if (!raw || !id) {
        void vscode.window.showWarningMessage(
          'Set your LeetCode username first (command "LeetCode: Set LeetCode username").'
        );
        return;
      }
      const cloudDoc = await fetchCloudStatsDocument(context, raw);
      if (!cloudDoc) {
        trackAnalytics("cloud_sync", "command_palette", "pull_cloud_stats", { result: "err" });
        void vscode.window.showInformationMessage("No cloud stats document found for this account.");
        return;
      }
      trackAnalytics("cloud_sync", "command_palette", "pull_cloud_stats", { result: "ok" });
      const choice = await vscode.window.showWarningMessage(
        "Merge cloud data into this machine? Replaces stored problem progress, timers, XP, interview history, and notes for keys present in the cloud snapshot.",
        { modal: true },
        "Merge"
      );
      if (choice !== "Merge") return;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Merging cloud stats…",
        },
        async () => {
          await applyCloudStatsMerge(globalState, cloudDoc);
        }
      );
      refreshAllProblemViews();
      updateGamificationStatusBars(context);
      await refreshStatsData(context, globalState);
      void vscode.window.showInformationMessage("Cloud stats merged.");
    })
  );

  const cloudPushInterval = setInterval(() => {
    if (!getCloudIdentity(globalState)) return;
    if (!sanitizeCloudUsername(getConfiguredLeetcodeUsername())) return;
    void pushStatsToCloud(context, globalState).then((r) => {
      if (!r.ok && r.reason === "firestore") {
        Logger.logError("Scheduled cloud push failed", new Error(r.message));
      }
    });
  }, PUSH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(cloudPushInterval) });

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openRandomProblem", async () => {
      trackAnalytics("command_invoked", "command_palette", "open_random", { source: "random" });
      const list = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading problems..." },
        () => problemsProvider.getProblemList()
      );
      const unsolved = list.filter(
        (item) => getStoredStatus(globalState, item.titleSlug) !== "solved"
      );
      const pool = unsolved.length > 0 ? unsolved : list;
      if (pool.length === 0) {
        vscode.window.showInformationMessage("No problems to open.");
        return;
      }
      const item = pool[Math.floor(Math.random() * pool.length)];
      await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.patternDrill", async () => {
      trackAnalytics("command_invoked", "command_palette", "pattern_drill");
      if (!(getProvider() instanceof LeetCodeProvider)) {
        void vscode.window.showInformationMessage(
          "Pattern Drill needs the default LeetCode source (problems must carry topic tags). Leave internalApiUrl empty.",
        );
        return;
      }
      await openPatternDrillWebview(context, {
        getProvider,
        loadItems: () => problemsProvider.getProblemList(),
        openProblem: async (slug: string) => {
          const problem = await getProvider().getProblem(slug);
          if (!problem) {
            void vscode.window.showErrorMessage("Could not fetch problem. Check network.");
            return;
          }
          const item = {
            id: problem.id,
            titleSlug: problem.titleSlug,
            title: problem.title,
            difficulty: problem.difficulty,
          };
          await openProblemWebview(context, item, getProvider, getProblemStatus, getWebviewOpts());
        },
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "leetcode-practice.practicePattern",
      async (patternId?: PatternId, leetcodeTag?: string) => {
        trackAnalytics("command_invoked", "command_palette", "practice_pattern");
        let target: PatternId | undefined = patternId;
        let tag: string | undefined = leetcodeTag;
        if (!target) {
          const weakest = pickWeakestPattern(globalState);
          if (!weakest) {
            void vscode.window.showInformationMessage("No mastery data yet — solve a few problems first.");
            return;
          }
          target = weakest.patternId;
          tag = weakest.leetcodeTag;
        }
        const meta = getPatternMeta(target);
        const list = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding ${meta.label} problems...` },
          () => problemsProvider.getProblemList()
        );
        const tagLower = (tag ?? meta.leetcodeTag ?? "").toLowerCase();
        const candidates = tagLower
          ? list.filter((p) =>
              Array.isArray(p.topicTags) &&
              p.topicTags.some(
                (t) => typeof t === "string" && t.toLowerCase().includes(tagLower)
              )
            )
          : [];
        const unsolved = candidates.filter(
          (p) => getStoredStatus(globalState, p.titleSlug) !== "solved"
        );
        const pool = unsolved.length > 0 ? unsolved : candidates;
        if (pool.length === 0) {
          void vscode.window.showInformationMessage(
            `No tagged problems found for ${meta.label}. Try /openProblem and pick one manually.`,
          );
          return;
        }
        const pick = pool[Math.floor(Math.random() * pool.length)];
        await openProblemWebview(context, pick, getProvider, getProblemStatus, getWebviewOpts());
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.showPatternMasterySummary", async () => {
      trackAnalytics("command_invoked", "command_palette", "pattern_mastery_summary");
      const summary = summarizePatternMastery(globalState);
      const total = summary.reduce((acc, s) => acc + s.solvedCount, 0);
      const strong = summary.filter((s) => s.rank === "strong").length;
      const practiced = summary.filter((s) => s.rank === "practiced").length;
      const rusty = summary.filter((s) => s.rank === "rusty").length;
      const untouched = summary.filter((s) => s.rank === "untouched").length;
      const items = summary.map<vscode.QuickPickItem>((s) => ({
        label: `${s.icon}  ${s.label}`,
        description:
          s.solvedCount === 0
            ? "untouched"
            : `${s.solvedCount} solved · mastery ${(s.masteryScore * 100).toFixed(0)}%`,
        detail: s.blurb,
      }));
      const header: vscode.QuickPickItem = {
        label: `Mastery: 🔥${strong} ·→${practiced} ··${rusty} ·✗${untouched}`,
        description: `${total} pattern-credits across ${summary.length} patterns`,
        kind: vscode.QuickPickItemKind.Separator,
      };
      const pick = await vscode.window.showQuickPick([header, ...items], {
        placeHolder: "Pick a pattern to practice (or Esc to dismiss)",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!pick || pick.kind === vscode.QuickPickItemKind.Separator) return;
      const matched = summary.find((s) => `${s.icon}  ${s.label}` === pick.label);
      if (matched) {
        await vscode.commands.executeCommand(
          "leetcode-practice.practicePattern",
          matched.patternId,
          matched.leetcodeTag,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.markAsSolved", async (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        trackAnalytics("command_invoked", "sidebar", "mark_solved", {
          difficulty: bucketDifficulty(node.item.difficulty),
        });
        setProblemStatus(globalState, node.item.titleSlug, "solved");
        await handleProblemSolved(context, node.item.titleSlug, getProvider);
        refreshAllProblemViews();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.markAsAttempting", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        trackAnalytics("command_invoked", "sidebar", "mark_attempting", {
          difficulty: bucketDifficulty(node.item.difficulty),
        });
        setProblemStatus(globalState, node.item.titleSlug, "attempting");
        refreshAllProblemViews();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.toggleAnalytics", async () => {
      const currentlyOn = isAnalyticsEnabled();
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(check) Enable anonymous analytics", value: true },
          { label: "$(circle-slash) Disable anonymous analytics", value: false },
        ],
        {
          placeHolder: currentlyOn ? "Currently: enabled" : "Currently: disabled",
          title: "Anonymous analytics",
        }
      );
      if (!pick) return;
      await setAnalyticsEnabled(pick.value);
      if (pick.value) {
        trackAnalytics("opt_in_change", "command_palette", "analytics_opt_in");
        void vscode.window.showInformationMessage(
          "Anonymous analytics enabled. Only a pseudonymous install ID + bucketed usage is sent."
        );
      } else {
        trackAnalytics("opt_in_change", "command_palette", "analytics_opt_out");
        await flushAnalytics();
        void vscode.window.showInformationMessage("Anonymous analytics disabled.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.clearProblemStatus", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        trackAnalytics("command_invoked", "sidebar", "clear_status");
        setProblemStatus(globalState, node.item.titleSlug, undefined);
        refreshAllProblemViews();
      }
    })
  );
  } catch (e) {
    console.error("[leetcode-practice] activate error:", e);
    vscode.window.showErrorMessage(
      "LeetCode Practice: failed to load some features. Sign In / Sign Out should still work."
    );
  }
}

export function deactivate(): Thenable<void> {
  disposeInlineDecorationTypes();
  return Promise.resolve(flushAnalytics()).catch(() => {});
}
