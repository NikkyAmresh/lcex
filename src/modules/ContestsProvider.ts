import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LeetCodeProvider,
  type ContestSummary,
  type ProblemListItem,
} from "./LeetCode";
import * as Logger from "./Logger";
import { getStoredStatus, type ProblemStatus } from "./ProblemsProvider";

const PAST_CACHE_FILE = "contests-past-cache.json";
const UPCOMING_CACHE_FILE = "contests-upcoming-cache.json";
const PAST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPCOMING_CACHE_TTL_MS = 10 * 60 * 1000;
const PAST_PAGE_SIZE = 100;
/** Buffer after `startTime + duration` before a "live" contest is treated as past (questions become viewable). */
const LIVE_TO_PAST_BUFFER_SEC = 5 * 60;

interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

function readCache<T>(filePath: string): CacheEnvelope<T> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch (e) {
    Logger.logError(`ContestsProvider: failed to read cache ${filePath}`, e);
    return null;
  }
}

function writeCache<T>(filePath: string, data: T): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ fetchedAt: Date.now(), data }), "utf-8");
  } catch (e) {
    Logger.logError(`ContestsProvider: failed to write cache ${filePath}`, e);
  }
}

function deleteCacheFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function formatCountdown(startTime: number, duration: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const endTime = startTime + duration;
  if (nowSec < startTime) {
    const diff = startTime - nowSec;
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (days >= 1) return `starts in ${days}d ${hours}h`;
    if (hours >= 1) return `starts in ${hours}h ${minutes}m`;
    if (minutes >= 1) return `starts in ${minutes}m`;
    return "starting now";
  }
  if (nowSec < endTime + LIVE_TO_PAST_BUFFER_SEC) {
    return "live now";
  }
  return "ended";
}

export class RootSectionItem extends vscode.TreeItem {
  constructor(public readonly section: "upcoming" | "past") {
    super(
      section === "upcoming" ? "Upcoming" : "Past",
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = "lcex.contestSection";
    this.iconPath = new vscode.ThemeIcon(section === "upcoming" ? "calendar" : "history");
  }
}

export class UpcomingContestItem extends vscode.TreeItem {
  constructor(public readonly contest: ContestSummary) {
    super(contest.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "lcex.upcomingContest";
    this.tooltip = contest.titleSlug;
    this.description = formatCountdown(contest.startTime, contest.duration);
    this.iconPath = new vscode.ThemeIcon("watch");
  }
}

export class YearGroupItem extends vscode.TreeItem {
  constructor(public readonly year: number, public readonly contests: ContestSummary[]) {
    super(String(year), vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "lcex.contestYear";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `${year} (${contests.length} contests)`;
  }
}

export class PastContestItem extends vscode.TreeItem {
  constructor(public readonly contest: ContestSummary) {
    super(contest.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "lcex.pastContest";
    this.tooltip = contest.titleSlug;
    const date = new Date(contest.startTime * 1000).toISOString().slice(0, 10);
    const qCount = contest.totalQuestions ? ` • ${contest.totalQuestions} problems` : "";
    this.description = `${date}${qCount}`;
    this.iconPath = new vscode.ThemeIcon(contest.type === "biweekly" ? "calendar" : "trophy");
  }
}

export class ContestProblemTreeItem extends vscode.TreeItem {
  constructor(
    public readonly item: ProblemListItem,
    status: ProblemStatus | undefined,
    public readonly contest: ContestSummary
  ) {
    super(`${item.id}. ${item.title}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "lcex.contestProblem";
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

export type ContestsTreeElement =
  | RootSectionItem
  | UpcomingContestItem
  | YearGroupItem
  | PastContestItem
  | ContestProblemTreeItem;

export class ContestsTreeProvider implements vscode.TreeDataProvider<ContestsTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private leetcode = new LeetCodeProvider();
  private upcoming: ContestSummary[] | null = null;
  private upcomingFetchedAt = 0;
  private past: ContestSummary[] | null = null;
  private pastFetchedAt = 0;
  private problemsBySlug = new Map<string, ProblemListItem[]>();
  private storagePath: string;
  private memento: vscode.Memento;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storagePath: string, memento: vscode.Memento) {
    this.storagePath = storagePath;
    this.memento = memento;
  }

  private get pastCachePath(): string {
    return path.join(this.storagePath, PAST_CACHE_FILE);
  }

  private get upcomingCachePath(): string {
    return path.join(this.storagePath, UPCOMING_CACHE_FILE);
  }

  private contestProblemsCachePath(slug: string): string {
    const safe = slug.replace(/[^a-z0-9-]/gi, "_");
    return path.join(this.storagePath, `contest-${safe}-cache.json`);
  }

  invalidate(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Drop all caches (in-memory + disk) and refire. */
  async refresh(): Promise<void> {
    this.upcoming = null;
    this.past = null;
    this.problemsBySlug.clear();
    deleteCacheFile(this.upcomingCachePath);
    deleteCacheFile(this.pastCachePath);
    try {
      const dir = this.storagePath;
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith("contest-") && entry.endsWith("-cache.json")) {
            try {
              fs.unlinkSync(path.join(dir, entry));
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      Logger.logError("ContestsProvider.refresh: failed to clear per-contest caches", e);
    }
    this._onDidChangeTreeData.fire();
  }

  /** Tick countdown labels — re-emits without refetch. */
  tickCountdowns(): void {
    if (this.upcoming && this.upcoming.length > 0) {
      this._onDidChangeTreeData.fire();
    }
  }

  startCountdownTimer(): void {
    if (this.countdownTimer) return;
    this.countdownTimer = setInterval(() => this.tickCountdowns(), 60_000);
  }

  stopCountdownTimer(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  dispose(): void {
    this.stopCountdownTimer();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: ContestsTreeElement): vscode.TreeItem {
    return element;
  }

  private async ensureUpcoming(): Promise<ContestSummary[]> {
    if (this.upcoming && Date.now() - this.upcomingFetchedAt < UPCOMING_CACHE_TTL_MS) {
      return this.upcoming;
    }
    const cached = readCache<ContestSummary[]>(this.upcomingCachePath);
    if (cached && Date.now() - cached.fetchedAt < UPCOMING_CACHE_TTL_MS) {
      this.upcoming = cached.data;
      this.upcomingFetchedAt = cached.fetchedAt;
      return this.upcoming;
    }
    const fresh = await this.leetcode.getUpcomingContests();
    this.upcoming = fresh;
    this.upcomingFetchedAt = Date.now();
    writeCache(this.upcomingCachePath, fresh);
    return fresh;
  }

  private async ensurePast(): Promise<ContestSummary[]> {
    if (this.past && Date.now() - this.pastFetchedAt < PAST_CACHE_TTL_MS) {
      return this.past;
    }
    const cached = readCache<ContestSummary[]>(this.pastCachePath);
    if (cached && Date.now() - cached.fetchedAt < PAST_CACHE_TTL_MS) {
      this.past = cached.data;
      this.pastFetchedAt = cached.fetchedAt;
      return this.past;
    }
    const all: ContestSummary[] = [];
    let skip = 0;
    while (true) {
      const page = await this.leetcode.getPastContests(skip, PAST_PAGE_SIZE);
      all.push(...page.contests);
      if (page.contests.length < PAST_PAGE_SIZE) break;
      if (page.totalNum && all.length >= page.totalNum) break;
      skip += PAST_PAGE_SIZE;
      if (skip > 5000) break;
    }
    all.sort((a, b) => b.startTime - a.startTime);
    this.past = all;
    this.pastFetchedAt = Date.now();
    writeCache(this.pastCachePath, all);
    return all;
  }

  /** Public wrapper around `ensureContestProblems` for callers that need a contest's problem list. */
  async getContestProblems(slug: string): Promise<ProblemListItem[]> {
    return this.ensureContestProblems(slug);
  }

  /** Returns the cached contest summary (past or upcoming) by slug, or null if not loaded. */
  findContestSummary(slug: string): ContestSummary | null {
    const inPast = this.past?.find((c) => c.titleSlug === slug);
    if (inPast) return inPast;
    const inUpcoming = this.upcoming?.find((c) => c.titleSlug === slug);
    return inUpcoming ?? null;
  }

  private async ensureContestProblems(slug: string): Promise<ProblemListItem[]> {
    const inMem = this.problemsBySlug.get(slug);
    if (inMem) return inMem;
    const cachePath = this.contestProblemsCachePath(slug);
    const cached = readCache<ProblemListItem[]>(cachePath);
    if (cached?.data && cached.data.length > 0) {
      this.problemsBySlug.set(slug, cached.data);
      return cached.data;
    }
    const items = await this.leetcode.getContestProblemListEnriched(slug);
    if (items.length > 0) {
      this.problemsBySlug.set(slug, items);
      writeCache(cachePath, items);
    }
    return items;
  }

  async getChildren(element?: ContestsTreeElement): Promise<ContestsTreeElement[]> {
    if (!element) {
      return [new RootSectionItem("upcoming"), new RootSectionItem("past")];
    }
    if (element instanceof RootSectionItem) {
      if (element.section === "upcoming") {
        const list = await this.ensureUpcoming();
        return list.map((c) => new UpcomingContestItem(c));
      }
      const list = await this.ensurePast();
      const byYear = new Map<number, ContestSummary[]>();
      for (const c of list) {
        const year = new Date(c.startTime * 1000).getFullYear();
        const arr = byYear.get(year) ?? [];
        arr.push(c);
        byYear.set(year, arr);
      }
      const years = [...byYear.keys()].sort((a, b) => b - a);
      return years.map((y) => new YearGroupItem(y, byYear.get(y) ?? []));
    }
    if (element instanceof YearGroupItem) {
      return element.contests.map((c) => new PastContestItem(c));
    }
    if (element instanceof PastContestItem) {
      const nowSec = Math.floor(Date.now() / 1000);
      const endTime = element.contest.startTime + element.contest.duration;
      if (nowSec < endTime + LIVE_TO_PAST_BUFFER_SEC) {
        return [];
      }
      const problems = await this.ensureContestProblems(element.contest.titleSlug);
      return problems.map(
        (p) => new ContestProblemTreeItem(p, getStoredStatus(this.memento, p.titleSlug), element.contest)
      );
    }
    return [];
  }
}
