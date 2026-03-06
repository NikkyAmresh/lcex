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
} from "./modules/ProblemView";
import { runExamples as runExamplesImpl } from "./modules/ExampleRunner";
import * as Logger from "./modules/Logger";

function getProvider(): IProblemProvider {
  const internalUrl = vscode.workspace
    .getConfiguration("leetcodePractice")
    .get<string>("internalApiUrl");
  if (internalUrl?.trim()) {
    return new InternalApiProvider(internalUrl.trim());
  }
  return new LeetCodeProvider();
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("LeetCode Practice");
  const profilerChannel = vscode.window.createOutputChannel("LeetCode Profiler");
  context.subscriptions.push(outputChannel, profilerChannel);
  Logger.init(outputChannel);

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
        const enableProfiler =
          ext === ".ts" &&
          (vscode.workspace.getConfiguration("leetcodePractice").get<boolean>("enableProfiler") ?? false);
        const profilerOpts = enableProfiler
          ? {
              useProfiler: true,
              outputChannel: profilerChannel,
              enableCpuProfile: true,
            }
          : undefined;
        const results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: enableProfiler ? "Running examples (profiling)..." : "Running examples...",
          },
          () => runExamplesImpl(uri, profilerOpts)
        );
        if (enableProfiler) profilerChannel.show();
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
  const problemsProvider = new ProblemsTreeProvider(
    "problemset",
    globalState,
    path.join(storagePath, "problemset-cache.json")
  );
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

  const topInterview150Provider = new ProblemsTreeProvider(
    "top-interview-150",
    globalState,
    path.join(storagePath, "top-interview-150-cache.json")
  );
  const topInterview150View = vscode.window.createTreeView(
    "leetcode-practice.topInterview150View",
    { treeDataProvider: topInterview150Provider }
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
          topInterview150Provider.refresh();
          await qotdProvider.refresh();
        }
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
      topInterview150Provider.setFilter(choice === "All" ? undefined : choice, undefined);
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
      topInterview150Provider.setFilter(undefined, query || undefined);
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
    topInterview150Provider.invalidate();
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
