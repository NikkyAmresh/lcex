import * as path from "path";
import * as vscode from "vscode";
import * as ejs from "ejs";
import type { IProblemProvider, Problem } from "./interface/Problem";
import type { ProblemListItem } from "./LeetCode";
import type { ProblemStatus } from "./ProblemsProvider";
import { getAllStatusEntries, type StoredStatusEntry } from "./ProblemsProvider";
import * as Database from "./Database";
import { LeetCodeProvider } from "./LeetCode";
import { generateTemplate } from "./TemplateEngine";
import { pollRunStatus, pollSubmitStatus } from "../utils/apiPoller";
import * as Logger from "./Logger";

export interface ProblemViewState {
  webviewPanel: vscode.WebviewPanel;
  problem: Problem;
  testcasesPanel?: vscode.WebviewPanel;
}

const problemViews = new Map<string, ProblemViewState>();

/** In-memory cache of problem data (by titleSlug) for instant show and soft reload. */
const problemCache = new Map<string, Problem>();

/** True after we have loaded from disk once this session; avoids re-reading on every open. */
let problemCacheLoadedFromDisk = false;

const CACHE_FILENAME = "problem-cache.json";

/** Single viewType so we can register one serializer to restore panels after window reload. */
export const PROBLEM_WEBVIEW_VIEWTYPE = "leetcodeProblem";

const WEBVIEW_OPTIONS: vscode.WebviewPanelOptions & {
  enableScripts?: boolean;
} = {
  enableScripts: true,
  retainContextWhenHidden: true,
};

function getCacheUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILENAME);
}

function getCachedProblem(titleSlug: string): Problem | undefined {
  return problemCache.get(titleSlug);
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

function getTemplatesDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "out", "templates");
}

async function solutionFileExists(problem: Problem): Promise<boolean> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const targetDir = Database.getTargetDir(uri);
  const fileName = Database.getFileName(problem.id, problem.titleSlug);
  const filePath = path.join(targetDir, fileName);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

async function renderChallengeHtml(
  context: vscode.ExtensionContext,
  problem: Problem,
  status?: ProblemStatus,
  isLoggedIn?: boolean
): Promise<string> {
  const templatesDir = getTemplatesDir(context);
  const content = problem.content || "<p>No description.</p>";
  const difficulty = problem.difficulty || "Unknown";
  const hasSolution = await solutionFileExists(problem);
  const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
  const note = notesMap[problem.titleSlug] ?? "";
  return ejs.renderFile(path.join(templatesDir, "challenge.ejs"), {
    id: problem.id,
    title: problem.title,
    titleSlug: problem.titleSlug,
    difficulty,
    isSolved: status === "solved",
    isLoggedIn: isLoggedIn ?? false,
    content,
    hasSolution,
    sampleTestCase: problem.sampleTestCase ?? "",
    note,
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
  globalState: vscode.Memento
): Promise<string> {
  await ensureProblemCacheLoaded(context);
  const entries = getAllStatusEntries(globalState);
  const solved = Object.entries(entries).filter(([, e]) => e.status === "solved");
  const attempting = Object.values(entries).filter((e) => e.status === "attempting").length;
  let easySolved = 0;
  let mediumSolved = 0;
  let hardSolved = 0;
  for (const [slug] of solved) {
    const difficulty = getCachedProblem(slug)?.difficulty ?? "Unknown";
    if (difficulty === "Easy") easySolved++;
    else if (difficulty === "Medium") mediumSolved++;
    else if (difficulty === "Hard") hardSolved++;
  }
  const totalSolved = solved.length;
  const streak = computeStreak(entries);

  let leetcodeProfile: {
    username: string;
    realName: string | null;
    userAvatar: string | null;
    easySolved: number;
    mediumSolved: number;
    hardSolved: number;
    totalSolved: number;
  } | null = null;
  const session = Database.getSession(context);
  if (session?.cookie?.trim()) {
    const leetcode = new LeetCodeProvider();
    leetcodeProfile = await leetcode.getUserProfileAndStats(session.cookie);
  }

  const templatesDir = getTemplatesDir(context);
  return ejs.renderFile(path.join(templatesDir, "stats.ejs"), {
    totalSolved,
    easySolved,
    mediumSolved,
    hardSolved,
    attempting,
    streak,
    leetcodeProfile,
  });
}

export async function openStatsWebview(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "leetcodeStats",
    "LeetCode Practice Stats",
    vscode.ViewColumn.One,
    { enableScripts: false }
  );
  panel.webview.html = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Loading stats..." },
    () => renderStatsHtml(context, globalState)
  );
}

const TERMINAL_CMD_BY_EXT: Record<string, string> = {
  ".ts": "ts-node",
  ".js": "node",
  ".py": "python3",
};

/** Runs the solution file in the terminal (ts-node / node / python3 by extension). */
export function runTsNodeInTerminal(filePath: string): void {
  const ext = path.extname(filePath);
  const enableProfiler =
    ext === ".ts" &&
    (vscode.workspace.getConfiguration("leetcodePractice").get<boolean>("enableProfiler") ?? false);
  const prefix = enableProfiler ? "NODE_OPTIONS='--cpu-prof' " : "";
  const cmd = TERMINAL_CMD_BY_EXT[ext] ?? "ts-node";
  const quoted = filePath.includes(" ") ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal("LeetCode");
  terminal.show();
  terminal.sendText(`${prefix}${cmd} ${quoted}`);
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
  if (!state?.webviewPanel) return;
  const status = getProblemStatus?.(titleSlug);
  const isLoggedIn = Database.isLoggedIn(context);
  state.problem = problem;
  state.webviewPanel.webview.html = await renderChallengeHtml(
    context,
    problem,
    status,
    isLoggedIn
  );
}

function setupPanelMessageHandler(
  context: vscode.ExtensionContext,
  titleSlug: string
): void {
  const state = problemViews.get(titleSlug);
  if (!state) return;
  state.webviewPanel.webview.onDidReceiveMessage(
    async (msg: { event: string; titleSlug: string; customInput?: string; note?: string }) => {
      const { event, titleSlug: msgSlug, customInput, note } = msg;
      const s = problemViews.get(msgSlug);
      if (!s) return;
      if (event === "solve") {
        await openOrCreateSolution(context, s.problem);
      } else if (event === "run") {
        const targetDir = Database.getTargetDir(
          vscode.window.activeTextEditor?.document.uri
        );
        const fileName = Database.getFileName(s.problem.id, s.problem.titleSlug);
        const filePath = path.join(targetDir, fileName);
        runTsNodeInTerminal(filePath);
      } else if (event === "runOnLeetCode" && customInput !== undefined) {
        await executeCode(context, s.problem, "run", customInput);
      } else if (event === "submit") {
        await executeCode(context, s.problem, "submit");
      } else if (event === "saveNote" && msgSlug && note !== undefined) {
        const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
        await context.globalState.update("leetcode-practice.problemNotes", { ...notesMap, [msgSlug]: note });
      }
    }
  );
}

export async function openProblemWebview(
  context: vscode.ExtensionContext,
  item: ProblemListItem,
  getProvider: () => IProblemProvider,
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined
): Promise<void> {
  const existing = problemViews.get(item.titleSlug);
  if (existing) {
    existing.webviewPanel.reveal();
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
      vscode.ViewColumn.One,
      WEBVIEW_OPTIONS
    );
    panel.webview.html = await renderChallengeHtml(
      context,
      cached,
      status,
      isLoggedIn
    );
    problemViews.set(item.titleSlug, { webviewPanel: panel, problem: cached });
    panel.onDidDispose(() => {
      const s = problemViews.get(item.titleSlug);
      s?.testcasesPanel?.dispose();
      problemViews.delete(item.titleSlug);
    });
    setupPanelMessageHandler(context, item.titleSlug);
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
    vscode.ViewColumn.One,
    WEBVIEW_OPTIONS
  );
  panel.webview.html = await renderChallengeHtml(
    context,
    problem,
    status,
    isLoggedIn
  );
  problemViews.set(item.titleSlug, { webviewPanel: panel, problem });
  panel.onDidDispose(() => {
    const s = problemViews.get(item.titleSlug);
    s?.testcasesPanel?.dispose();
    problemViews.delete(item.titleSlug);
  });
  setupPanelMessageHandler(context, item.titleSlug);
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
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined
): Promise<void> {
  const titleSlug = state?.titleSlug;
  if (!titleSlug) {
    panel.webview.html = "<p>Unable to restore: no problem state.</p>";
    return;
  }
  await ensureProblemCacheLoaded(context);
  let problem = getCachedProblem(titleSlug);
  if (!problem) {
    problem = (await getProvider().getProblem(titleSlug)) ?? undefined;
    if (problem) setCachedProblem(titleSlug, problem, context);
  }
  if (!problem) {
    panel.webview.html = "<p>Could not load problem. Try opening from the list again.</p>";
    return;
  }
  panel.title = problem.title;
  const status = getProblemStatus?.(titleSlug);
  const isLoggedIn = Database.isLoggedIn(context);
  panel.webview.html = await renderChallengeHtml(
    context,
    problem,
    status,
    isLoggedIn
  );
  problemViews.set(titleSlug, { webviewPanel: panel, problem });
  panel.onDidDispose(() => {
    const s = problemViews.get(titleSlug);
    s?.testcasesPanel?.dispose();
    problemViews.delete(titleSlug);
  });
  setupPanelMessageHandler(context, titleSlug);
}

export async function openOrCreateSolution(
  context: vscode.ExtensionContext,
  problem: Problem
): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const targetDir = Database.getTargetDir(uri);
  const fileName = Database.getFileName(problem.id, problem.titleSlug);
  const filePath = path.join(targetDir, fileName);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  } catch {
    const lang = (vscode.workspace.getConfiguration("leetcodePractice").get<string>("language") ?? "typescript") as "typescript" | "javascript" | "python";
    const content = generateTemplate(problem, { language: lang });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, "utf8"));
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Two });
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
  const langSlug =
    ext === ".py" ? "python3" : ext === ".js" ? "javascript" : "typescript";
  if (!editor || !/[.]ts$|[.]js$|[.]py$/.test(fileName)) {
    vscode.window.showWarningMessage("Open a solution file (.ts, .js, or .py) and try again.");
    return;
  }
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
