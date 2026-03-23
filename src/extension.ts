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
import type { ProblemPanelState } from "./modules/ProblemView";
import {
  openProblemWebview,
  openStatsWebview,
  refreshStatsData,
  runTsNodeInTerminal,
  PROBLEM_WEBVIEW_VIEWTYPE,
  restoreProblemPanel,
  getTitleSlugForActiveSolutionFile,
  notifyAllProblemPanelsUiMode,
  getCachedProblemDifficulty,
} from "./modules/ProblemView";
import { runExamples as runExamplesImpl } from "./modules/ExampleRunner";
import * as Logger from "./modules/Logger";
import {
  parseLeetcodeConfig,
  getEffectiveConfig,
  resolveDefaultStudyPlanSlug,
  resolveDefaultProblemListSlug,
} from "./modules/LeetcodeConfig";
import { LeetcodeConfigEditorProvider } from "./modules/LeetcodeConfigEditor";
import { initProblemTimer, disposeProblemTimer, TIMER_BY_DAY_KEY } from "./modules/ProblemTimer";
import {
  awardXpForFirstSolve,
  countSolvedToday,
  getDailyGoal as readDailyGoal,
  getTotalXp,
  setDailyGoal as persistDailyGoal,
  sumTimerMinutesToday,
  todayIso,
  xpLevelProgress,
  FOCUS_COMPACT_WEBVIEW_KEY,
} from "./modules/Gamification";
import {
  endInterviewSession,
  getInterviewSession,
  recordInterviewSolve,
  remainingMs,
  startInterviewSession,
  setInterviewContext,
} from "./modules/InterviewMode";

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

function shouldAutoApplyTheme(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    Logger.log("Theme auto-apply: no workspace folders, skipping");
    return false;
  }
  const hasMarker = folders.some(hasLeetcodeMarker);
  folders.forEach((f) => {
    const markerPath = path.join(f.uri.fsPath, LEETCODE_MARKER);
    Logger.log(`Theme auto-apply: folder=${f.uri.fsPath} .leetcode exists=${fs.existsSync(markerPath)}`);
  });
  Logger.log(`Theme auto-apply: shouldApply=${hasMarker}`);
  return hasMarker;
}

const HAS_MARKER_CONTEXT = "leetcodePractice.hasMarker";
const SHOW_PROBLEMSET_CONTEXT = "leetcodePractice.showProblemset";
const SHOW_STUDY_PLANS_CONTEXT = "leetcodePractice.showStudyPlans";
const SHOW_PROBLEM_LISTS_CONTEXT = "leetcodePractice.showProblemLists";
const SHOW_QOTD_CONTEXT = "leetcodePractice.showQotd";
const IS_SOLUTION_FILE_CONTEXT = "leetcodePractice.isSolutionFile";

const SOLUTION_EXTENSIONS = new Set([".ts", ".js", ".py"]);

const NUMBERED_FILE_PATTERN = /^(\d+)\.(ts|js|py)$/i;

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
      statusBarHint.tooltip = "Ask agent: Get a hint (prompt from .leetcode)";
      statusBarHint.command = "leetcode-practice.agentHint";
      statusBarHint.show();
    } else {
      statusBarHint.hide();
    }
  }
}

function updateHasMarkerContext(): void {
  const hasMarker = shouldAutoApplyTheme();
  void vscode.commands.executeCommand("setContext", HAS_MARKER_CONTEXT, hasMarker);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = folders.length > 0 ? getEffectiveConfig(folders) : null;
  void vscode.commands.executeCommand("setContext", SHOW_PROBLEMSET_CONTEXT, config?.showProblemset ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_STUDY_PLANS_CONTEXT, config?.showStudyPlans ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_PROBLEM_LISTS_CONTEXT, config?.showProblemLists ?? true);
  void vscode.commands.executeCommand("setContext", SHOW_QOTD_CONTEXT, config?.showQotd ?? true);
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

/** Handles vscode://lcex.leetcode-practice/open/{slug} — opens the extension and the problem. */
function createUriHandler(
  context: vscode.ExtensionContext,
  getProvider: () => IProblemProvider,
  getWebviewOpts?: () => { onMarkSolved: (titleSlug: string) => void } | undefined
): vscode.UriHandler {
  return {
    handleUri(uri: vscode.Uri): void {
      const path = uri.path ?? "";
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

let interviewStatusBar: vscode.StatusBarItem | undefined;
let dailyGoalStatusBar: vscode.StatusBarItem | undefined;
let xpStatusBar: vscode.StatusBarItem | undefined;
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
      void endInterviewSession(context.globalState, "timer").then((entry) => {
        void setInterviewContext(false);
        interviewStatusBar?.hide();
        notifyAllProblemPanelsUiMode(context);
        updateGamificationStatusBars(context);
        if (entry) {
          vscode.window.showInformationMessage(
            `Interview ended (time up). +${entry.bonusXp} bonus XP. Solved ${entry.solvedCount} in session.`
          );
        }
      });
      return;
    }
    const rm = remainingMs(sess);
    const m = Math.floor(rm / 60_000);
    const s = Math.floor((rm % 60_000) / 1000);
    if (interviewStatusBar) {
      interviewStatusBar.text = `$(vm-running) ${m}:${s < 10 ? "0" : ""}${s}`;
      interviewStatusBar.tooltip = "Interview mode — click to stop";
      interviewStatusBar.command = "leetcode-practice.interviewModeStop";
      interviewStatusBar.show();
    }
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
  interviewStatusBar.text = `$(vm-running) ${m}:${s < 10 ? "0" : ""}${s}`;
  interviewStatusBar.tooltip = "Interview mode — click to stop";
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
    void endInterviewSession(context.globalState, "timer").then((entry) => {
      notifyAllProblemPanelsUiMode(context);
      updateGamificationStatusBars(context);
      if (entry) {
        vscode.window.showInformationMessage(
          `Interview session had expired. Logged +${entry.bonusXp} bonus XP.`
        );
      }
    });
    return;
  }
  void setInterviewContext(true);
  startInterviewTick(context);
  refreshInterviewStatusBarNow(context);
}

async function resolveProblemContextForExplain(): Promise<{ title: string; titleSlug: string } | undefined> {
  const fromPanel = getTitleSlugForActiveSolutionFile();
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

function handleProblemSolved(context: vscode.ExtensionContext, titleSlug: string): void {
  void (async () => {
    const diff = getCachedProblemDifficulty(titleSlug);
    await awardXpForFirstSolve(context.globalState, titleSlug, diff);
    await recordInterviewSolve(context.globalState, titleSlug);
    updateGamificationStatusBars(context);
  })();
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
  if (!shouldAutoApplyTheme()) {
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

let extensionContextForBars: vscode.ExtensionContext | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extensionContextForBars = context;
  const outputChannel = vscode.window.createOutputChannel("LeetCode Practice");
  context.subscriptions.push(outputChannel);
  Logger.init(outputChannel);
  Logger.log("Extension activated");

  let webviewOpts: { onMarkSolved: (titleSlug: string) => void } | undefined;
  const getWebviewOpts = () => webviewOpts;
  context.subscriptions.push(
    vscode.window.registerUriHandler(
      createUriHandler(context, getProvider, getWebviewOpts)
    )
  );

  // Defer theme apply and sidebar visibility so the contributed theme is registered before we set it
  setImmediate(() => {
    Logger.log("Theme auto-apply: scheduled (setImmediate)");
    void applyLeetcodeThemeIfNeeded();
    updateHasMarkerContext();
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      Logger.log("Theme auto-apply: workspace folders changed, rechecking...");
      void applyLeetcodeThemeIfNeeded();
      updateHasMarkerContext();
    })
  );
  const leetcodeWatcher = vscode.workspace.createFileSystemWatcher("**/.leetcode");
  leetcodeWatcher.onDidCreate(() => {
    updateHasMarkerContext();
    void applyLeetcodeThemeIfNeeded();
  });
  leetcodeWatcher.onDidDelete(() => updateHasMarkerContext());
  leetcodeWatcher.onDidChange(() => {
    updateHasMarkerContext();
    void applyLeetcodeThemeIfNeeded();
  });
  context.subscriptions.push(leetcodeWatcher);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateSolutionFileContext();
      updateAgentStatusBarVisibility();
    })
  );

  statusBarMakeRunnable = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarHint = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  const statusBarTimer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  interviewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  dailyGoalStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
  xpStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  context.subscriptions.push(
    statusBarMakeRunnable,
    statusBarHint,
    statusBarTimer,
    interviewStatusBar,
    dailyGoalStatusBar,
    xpStatusBar
  );
  context.subscriptions.push({ dispose: () => stopInterviewTick() });
  initProblemTimer(context, statusBarTimer, shouldAutoApplyTheme, getTitleSlugForActiveSolutionFile);
  context.subscriptions.push({ dispose: () => disposeProblemTimer() });
  updateAgentStatusBarVisibility();
  updateGamificationStatusBars(context);
  restoreInterviewOnActivate(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "leetcode-practice.configEditor",
      new LeetcodeConfigEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register sign-in/sign-out first so they always exist
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.signIn", () => {
      Authentication.signIn(context).catch((e) => {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.signOut", () => {
      Authentication.signOut(context).catch((e) => {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.applyTheme", async () => {
      await applyLeetcodeThemeIfNeeded();
      if (shouldAutoApplyTheme()) {
        vscode.window.showInformationMessage("LeetCode Dark theme applied (workspace has .leetcode)");
      } else {
        vscode.window.showWarningMessage("No .leetcode file in workspace root. Add one to auto-apply the theme.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.agentMakeRunnable", async () => {
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
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.agentHint", async () => {
      if (getInterviewSession(context.globalState)) {
        vscode.window.showWarningMessage("Hints are disabled during Interview mode.");
        return;
      }
      if (!shouldAutoApplyTheme()) {
        vscode.window.showWarningMessage("LeetCode workspace (.leetcode) required. Open a workspace with a .leetcode file.");
        return;
      }
      const folders = vscode.workspace.workspaceFolders ?? [];
      const config = getEffectiveConfig(folders);
      const prompt = config.agentPromptHint?.trim() || "Give me a hint for this problem. Do not give the solution.";
      await openChatWithPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.agentExplainCode", async () => {
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
      const prob = await resolveProblemContextForExplain();
      const ctx = prob
        ? `\n\nProblem: ${prob.title} (slug: ${prob.titleSlug})\n`
        : `\n\nProblem context unknown (file: ${path.basename(editor!.document.fileName)}).\n`;
      const ext = editor ? path.extname(editor.document.fileName).replace(".", "") : "txt";
      const prompt = `${base}${ctx}\nSelected code:\n\`\`\`${ext}\n${text}\n\`\`\``;
      await openChatWithPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.focusModeEnter", async () => {
      await context.globalState.update(FOCUS_COMPACT_WEBVIEW_KEY, true);
      notifyAllProblemPanelsUiMode(context);
      const cmds = [
        "workbench.action.closeSidebar",
        "workbench.action.closePanel",
        "workbench.action.toggleZenMode",
        "workbench.action.toggleMaximizeEditorGroup",
      ];
      for (const id of cmds) {
        try {
          await vscode.commands.executeCommand(id);
        } catch {
          /* command may be unavailable */
        }
      }
      vscode.window.showInformationMessage("Focus mode: sidebar/panel hidden, Zen + compact problem chrome. Use Focus Mode (exit) to restore workbench toggles.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.focusModeExit", async () => {
      await context.globalState.update(FOCUS_COMPACT_WEBVIEW_KEY, false);
      notifyAllProblemPanelsUiMode(context);
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.setDailyGoal", async () => {
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
      if (getInterviewSession(context.globalState)) {
        vscode.window.showWarningMessage("An interview session is already active.");
        return;
      }
      const dur = await vscode.window.showQuickPick(
        [
          { label: "45 minutes", value: 45 as const },
          { label: "60 minutes", value: 60 as const },
          { label: "180 minutes (3 hours)", value: 180 as const },
        ],
        { placeHolder: "Interview duration" }
      );
      if (!dur) return;
      const raw = await vscode.window.showInputBox({
        prompt: "Optional: planned problem slugs (comma-separated)",
        placeHolder: "e.g. two-sum, add-two-numbers",
      });
      const planned = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      await startInterviewSession(context.globalState, dur.value, planned);
      await setInterviewContext(true);
      notifyAllProblemPanelsUiMode(context);
      startInterviewTick(context);
      refreshInterviewStatusBarNow(context);
      updateGamificationStatusBars(context);
      vscode.window.showInformationMessage(
        `Interview mode started (${dur.value} min). Hints and Explain are hidden/disabled.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.interviewModeStop", async () => {
      const entry = await endInterviewSession(context.globalState, "user");
      stopInterviewTick();
      interviewStatusBar?.hide();
      notifyAllProblemPanelsUiMode(context);
      updateGamificationStatusBars(context);
      if (!entry) {
        vscode.window.showInformationMessage("No active interview session.");
      } else {
        vscode.window.showInformationMessage(
          `Interview stopped. +${entry.bonusXp} bonus XP. Solved ${entry.solvedCount} in this session.`
        );
      }
    })
  );

  try {
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.openQotd", async () => {
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
    vscode.commands.registerCommand("leetcode-practice.openProblem", async () => {
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
      if (!uri || ![".ts", ".js", ".py"].includes(ext)) {
        vscode.window.showWarningMessage(
          "Open a .ts, .js, or .py solution file with example blocks to run examples."
        );
        return;
      }

      try {
        const results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Running examples...",
          },
          () => runExamplesImpl(uri)
        );
        if (results.length === 0) {
          vscode.window.showInformationMessage(
            "No console.log example blocks found."
          );
          return;
        }
        const passed = results.filter((r) => r.pass).length;
        const failed = results.filter((r) => !r.pass);
        if (failed.length === 0) {
          vscode.window.showInformationMessage(
            `All ${passed} example(s) passed.`
          );
        } else {
          const msg = failed
            .map(
              (f) =>
                `Line ${f.lineIndex}: expected ${f.expected ?? "?"}, got ${f.actual}`
            )
            .join("\n");
          vscode.window.showErrorMessage(
            `${passed}/${results.length} passed.\n${msg}`
          );
        }
      } catch (e) {
        vscode.window.showErrorMessage(
          e instanceof Error ? e.message : String(e)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.runInTerminal", () => {
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      const ext = filePath ? path.extname(filePath) : "";
      if (!filePath || ![".ts", ".js", ".py"].includes(ext)) {
        vscode.window.showWarningMessage("Open a .ts, .js, or .py solution file to run.");
        return;
      }
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
  function refreshAllProblemViews(): void {
    problemsProvider.invalidate();
    studyPlanProvider.invalidate();
    problemListProvider.invalidate();
    qotdProvider.invalidate();
  }
  webviewOpts = {
    onMarkSolved: (titleSlug) => {
      setProblemStatus(globalState, titleSlug, "solved");
      handleProblemSolved(context, titleSlug);
      refreshAllProblemViews();
    },
  };
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      PROBLEM_WEBVIEW_VIEWTYPE,
      {
        deserializeWebviewPanel(panel, state) {
          return restoreProblemPanel(
            context,
            panel,
            state as ProblemPanelState | undefined,
            getProvider,
            getProblemStatus,
            getWebviewOpts()
          );
        },
      }
    )
  );
  qotdView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as QotdTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus, getWebviewOpts());
  });
  context.subscriptions.push(qotdView);

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshProblems", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing problems..." },
        async () => {
          problemsProvider.refresh();
          studyPlanProvider.refresh();
          problemListProvider.refresh();
          await qotdProvider.refresh();
          fileDecorationProvider.invalidate();
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.switchStudyPlan", async () => {
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
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing Question of the Day..." },
        () => qotdProvider.refresh()
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.filterByDifficulty", async () => {
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
    vscode.commands.registerCommand("leetcode-practice.openRandomProblem", async () => {
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
    vscode.commands.registerCommand("leetcode-practice.markAsSolved", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        setProblemStatus(globalState, node.item.titleSlug, "solved");
        handleProblemSolved(context, node.item.titleSlug);
        refreshAllProblemViews();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.markAsAttempting", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        setProblemStatus(globalState, node.item.titleSlug, "attempting");
        refreshAllProblemViews();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.clearProblemStatus", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
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

export function deactivate(): void {}
