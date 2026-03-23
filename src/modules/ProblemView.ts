import * as path from "path";
import * as vscode from "vscode";
import * as ejs from "ejs";
import type { IProblemProvider, Problem } from "./interface/Problem";
import type { ProblemListItem } from "./LeetCode";
import type { ProblemStatus } from "./ProblemsProvider";
import { getAllStatusEntries, setProblemStatus, type StoredStatusEntry } from "./ProblemsProvider";
import * as Database from "./Database";
import { getEffectiveConfig } from "./LeetcodeConfig";
import { LeetCodeProvider } from "./LeetCode";
import { generateTemplate } from "./TemplateEngine";
import { pollRunStatus, pollSubmitStatus } from "../utils/apiPoller";
import * as Logger from "./Logger";
import { getProblemTimer, TIMER_BY_DAY_KEY, TIMER_ELAPSED_KEY, type TimerByDay } from "./ProblemTimer";

export interface ProblemViewState {
  webviewPanel: vscode.WebviewPanel;
  problem: Problem;
  testcasesPanel?: vscode.WebviewPanel;
}

const problemViews = new Map<string, ProblemViewState>();

/** Single stats webview (reused + refresh command target). */
let statsWebviewPanel: vscode.WebviewPanel | null = null;

/** Days until on-disk problemset difficulty cache is ignored and refetched for stats. */
export const PROBLEMSET_DIFFICULTY_CACHE_TTL_DAYS = 7;
const PROBLEMSET_DIFFICULTY_CACHE_TTL_MS =
  PROBLEMSET_DIFFICULTY_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

const SOLUTION_EXTENSIONS = new Set([".ts", ".js", ".py"]);

/** Returns titleSlug if the active editor is a solution file for a registered problem; otherwise null. */
export function getTitleSlugForActiveSolutionFile(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const ext = path.extname(editor.document.uri.fsPath).toLowerCase();
  if (!SOLUTION_EXTENSIONS.has(ext)) return null;
  const editorPath = path.resolve(editor.document.uri.fsPath);
  for (const [, state] of problemViews) {
    const { idPath, slugPath } = Database.getSolutionPathSet(
      editor.document.uri,
      state.problem.id,
      state.problem.titleSlug
    );
    if (editorPath === path.resolve(idPath) || editorPath === path.resolve(slugPath)) {
      return state.problem.titleSlug;
    }
  }
  return null;
}

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

async function solutionFileExists(problem: Problem): Promise<boolean> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const { exists } = await Database.resolveSolutionFilePathForOpen(
    uri,
    problem.id,
    problem.titleSlug
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
  const hasSolution = await solutionFileExists(problem);
  const isSolved = status === "solved";

  let solutionContent: string | undefined;
  let solutionHtml: string | undefined;
  let solutionLang: string | undefined;
  if (isSolved) {
    const { path: solutionPath, exists } = await Database.resolveSolutionFilePathForOpen(
      undefined,
      problem.id,
      problem.titleSlug
    );
    if (exists) {
      try {
        const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(solutionPath));
        const raw = Buffer.from(buf).toString("utf8");
        solutionContent = raw;
        const ext = path.extname(solutionPath).toLowerCase();
        const lang = ext === ".ts" ? "typescript" : ext === ".js" ? "javascript" : ext === ".py" ? "python" : "typescript";
        const theme =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
            ? "light-plus"
            : "dark-plus";
        const { codeToHtml } = await import("shiki");
        solutionHtml = await codeToHtml(raw, { lang, theme });
      } catch {
        solutionHtml = undefined;
      }
    }
  }

  const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
  const note = notesMap[problem.titleSlug] ?? "";
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

const TERMINAL_CMD_BY_EXT: Record<string, string> = {
  ".ts": "ts-node",
  ".js": "node",
  ".py": "python3",
};

/** Runs the solution file in the terminal (ts-node / node / python3 by extension). */
export function runTsNodeInTerminal(filePath: string): void {
  const ext = path.extname(filePath);
  const cmd = TERMINAL_CMD_BY_EXT[ext] ?? "ts-node";
  const quoted = filePath.includes(" ") ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal("LeetCode");
  terminal.show();
  terminal.sendText(`${cmd} ${quoted}`);
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
    isLoggedIn,
    state.webviewPanel.webview
  );
}

interface SetupPanelMessageHandlerOpts {
  getProvider?: () => IProblemProvider;
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined;
  onMarkSolved?: (titleSlug: string) => void;
}

function setupPanelMessageHandler(
  context: vscode.ExtensionContext,
  titleSlug: string,
  opts?: SetupPanelMessageHandlerOpts
): void {
  const state = problemViews.get(titleSlug);
  if (!state) return;
  state.webviewPanel.webview.onDidReceiveMessage(
    async (msg: { event: string; titleSlug: string; customInput?: string; note?: string }) => {
      const { event, titleSlug: msgSlug, customInput, note } = msg;
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
        await openOrCreateSolution(context, s.problem);
      } else if (event === "run") {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const { path: filePath } = await Database.resolveSolutionFilePathForOpen(
          uri,
          s.problem.id,
          s.problem.titleSlug
        );
        runTsNodeInTerminal(filePath);
      } else if (event === "runOnLeetCode" && customInput !== undefined) {
        await executeCode(context, s.problem, "run", customInput);
      } else if (event === "submit") {
        await executeCode(context, s.problem, "submit");
      } else if (event === "markAsSolved") {
        getProblemTimer()?.handlePause(msgSlug);
        if (opts?.onMarkSolved) {
          opts.onMarkSolved(msgSlug);
        } else {
          setProblemStatus(context.globalState, msgSlug, "solved");
        }
        if (opts?.getProvider && opts?.getProblemStatus) {
          await softReload(context, msgSlug, opts.getProvider, opts.getProblemStatus);
        }
      } else if (event === "saveNote" && msgSlug && note !== undefined) {
        const notesMap = context.globalState.get<Record<string, string>>("leetcode-practice.problemNotes") ?? {};
        await context.globalState.update("leetcode-practice.problemNotes", { ...notesMap, [msgSlug]: note });
      }
    }
  );
}

export interface OpenProblemWebviewOpts {
  onMarkSolved?: (titleSlug: string) => void;
}

export async function openProblemWebview(
  context: vscode.ExtensionContext,
  item: ProblemListItem,
  getProvider: () => IProblemProvider,
  getProblemStatus?: (titleSlug: string) => ProblemStatus | undefined,
  opts?: OpenProblemWebviewOpts
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
    });
    getProblemTimer()?.registerPanel(item.titleSlug, panel, cached.title, status === "solved");
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
  });
  getProblemTimer()?.registerPanel(item.titleSlug, panel, problem.title, status === "solved");
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
  });
  getProblemTimer()?.registerPanel(titleSlug, panel, problem.title, status === "solved");
}

export async function openOrCreateSolution(
  context: vscode.ExtensionContext,
  problem: Problem
): Promise<void> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const { path: filePath, exists } = await Database.resolveSolutionFilePathForOpen(
    uri,
    problem.id,
    problem.titleSlug
  );
  if (!exists) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const config = getEffectiveConfig(folders);
    const lang = (config.language ?? "typescript") as "typescript" | "javascript" | "python";
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
