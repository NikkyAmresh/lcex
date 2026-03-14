import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { IProblemProvider } from "./modules/interface/Problem";
import { LeetCodeProvider, type DailyChallengeEntry, type ProblemListItem } from "./modules/LeetCode";
import { InternalApiProvider } from "./modules/InternalProvider";
import * as Authentication from "./modules/Authentication";
import { ProblemsTreeProvider, ProblemTreeItem, setProblemStatus, getStoredStatus } from "./modules/ProblemsProvider";
import type { ProblemPanelState } from "./modules/ProblemView";
import {
  openProblemWebview,
  openStatsWebview,
  runTsNodeInTerminal,
  PROBLEM_WEBVIEW_VIEWTYPE,
  restoreProblemPanel,
  getTitleSlugForActiveSolutionFile,
} from "./modules/ProblemView";
import { runExamples as runExamplesImpl } from "./modules/ExampleRunner";
import * as Logger from "./modules/Logger";
import { parseLeetcodeConfig, getEffectiveConfig } from "./modules/LeetcodeConfig";
import { LeetcodeConfigEditorProvider } from "./modules/LeetcodeConfigEditor";
import { initProblemTimer, disposeProblemTimer } from "./modules/ProblemTimer";

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
const SHOW_QOTD_CONTEXT = "leetcodePractice.showQotd";
const IS_SOLUTION_FILE_CONTEXT = "leetcodePractice.isSolutionFile";

const SOLUTION_EXTENSIONS = new Set([".ts", ".js", ".py"]);

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
  void vscode.commands.executeCommand("setContext", SHOW_QOTD_CONTEXT, config?.showQotd ?? true);
  updateSolutionFileContext();
  updateAgentStatusBarVisibility();
  Logger.log(`Sidebar visibility: hasMarker=${hasMarker}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("LeetCode Practice");
  context.subscriptions.push(outputChannel);
  Logger.init(outputChannel);
  Logger.log("Extension activated");

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
  context.subscriptions.push(statusBarMakeRunnable, statusBarHint, statusBarTimer);
  initProblemTimer(context, statusBarTimer, shouldAutoApplyTheme, getTitleSlugForActiveSolutionFile);
  context.subscriptions.push({ dispose: () => disposeProblemTimer() });
  updateAgentStatusBarVisibility();

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
          await openProblemWebview(context, item, getProvider, getProblemStatus);
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
          await openProblemWebview(context, item, getProvider, getProblemStatus);
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
  const problemsProvider = new ProblemsTreeProvider("problemset", globalState, storagePath);
  const treeView = vscode.window.createTreeView(
    "leetcode-practice.problemsView",
    { treeDataProvider: problemsProvider }
  );
  const getProblemStatus = (slug: string) => getStoredStatus(globalState, slug);

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
            getProblemStatus
          );
        },
      }
    )
  );

  treeView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as ProblemTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus);
  });
  context.subscriptions.push(treeView);

  const STUDY_PLANS_KEY = "leetcode-practice.selectedStudyPlan";
  const folders = vscode.workspace.workspaceFolders ?? [];
  const leetcodeConfig = getEffectiveConfig(folders);
  const studyPlansConfig = leetcodeConfig.studyPlans ?? [
    { slug: "top-interview-150", name: "Top Interview 150" },
  ];
  const defaultPlan = studyPlansConfig[0];
  const initialPlanSlug =
    context.workspaceState.get<string>(STUDY_PLANS_KEY) ??
    leetcodeConfig.activeStudyPlan ??
    defaultPlan?.slug ??
    "top-interview-150";
  const studyPlanProvider = new ProblemsTreeProvider(initialPlanSlug, globalState, storagePath);
  const topInterview150View = vscode.window.createTreeView(
    "leetcode-practice.topInterview150View",
    { treeDataProvider: studyPlanProvider }
  );
  topInterview150View.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as ProblemTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus);
  });
  context.subscriptions.push(topInterview150View);

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
  qotdView.onDidChangeSelection(async (e) => {
    const item = e.selection[0] as QotdTreeItem | undefined;
    if (!item?.item) return;
    await openProblemWebview(context, item.item, getProvider, getProblemStatus);
  });
  context.subscriptions.push(qotdView);

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.refreshProblems", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing problems..." },
        async () => {
          problemsProvider.refresh();
          studyPlanProvider.refresh();
          await qotdProvider.refresh();
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.switchStudyPlan", async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const leetcodeConfig = getEffectiveConfig(folders);
      const plans = leetcodeConfig.studyPlans ?? [{ slug: "top-interview-150", name: "Top Interview 150" }];
      if (plans.length === 0) {
        vscode.window.showInformationMessage("No study plans configured. Add plans in leetcodePractice.studyPlans.");
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
      await openProblemWebview(context, item, getProvider, getProblemStatus);
    })
  );

  function refreshAllProblemViews(): void {
    problemsProvider.invalidate();
    studyPlanProvider.invalidate();
    qotdProvider.invalidate();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("leetcode-practice.markAsSolved", (node: ProblemTreeItem) => {
      if (node?.item?.titleSlug) {
        setProblemStatus(globalState, node.item.titleSlug, "solved");
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
