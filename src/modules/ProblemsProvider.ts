import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LeetCodeProvider,
  slugToTitle,
  type ProblemListItem,
  type StudyPlanGroup,
} from "./LeetCode";
import { NO_PROBLEM_LIST_SENTINEL } from "./LeetcodeConfig";
const STATUS_KEY = "leetcode-practice.problemStatus";

export type ProblemStatus = "solved" | "attempting";

/** "problemset" for full list; string = study plan or problem-list slug */
export type ProblemListKind = "problemset" | string;

/** How a non-problemset slug is resolved on LeetCode. */
export type NonProblemsetListSource = "studyPlan" | "problemList";

export interface ProblemsTreeProviderOptions {
  initialListSource?: NonProblemsetListSource;
  /** Display name for problem-list single category (from config). */
  problemListCategoryLabel?: string;
  getCookie?: () => string | undefined;
}

export interface StoredStatusEntry {
  status: ProblemStatus;
  solvedAt?: string;
}

function getRawEntry(
  memento: vscode.Memento,
  titleSlug: string
): StoredStatusEntry | undefined {
  const map = memento.get<Record<string, StoredStatusEntry | ProblemStatus>>(STATUS_KEY);
  const raw = map?.[titleSlug];
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return { status: raw };
  return raw;
}

export function getStoredStatus(memento: vscode.Memento, titleSlug: string): ProblemStatus | undefined {
  return getRawEntry(memento, titleSlug)?.status;
}

export function setProblemStatus(
  memento: vscode.Memento,
  titleSlug: string,
  status: ProblemStatus | undefined
): void {
  const map = memento.get<Record<string, StoredStatusEntry>>(STATUS_KEY) ?? {};
  if (status === undefined) {
    const next = { ...map };
    delete next[titleSlug];
    memento.update(STATUS_KEY, next);
  } else {
    const entry: StoredStatusEntry =
      status === "solved"
        ? { status, solvedAt: new Date().toISOString().slice(0, 10) }
        : { status };
    memento.update(STATUS_KEY, { ...map, [titleSlug]: entry });
  }
}

export function getAllStatusEntries(
  memento: vscode.Memento
): Record<string, StoredStatusEntry> {
  const map = memento.get<Record<string, StoredStatusEntry | ProblemStatus>>(STATUS_KEY) ?? {};
  const result: Record<string, StoredStatusEntry> = {};
  for (const [slug, raw] of Object.entries(map)) {
    if (typeof raw === "string") result[slug] = { status: raw };
    else result[slug] = raw;
  }
  return result;
}

export class ProblemTreeItem extends vscode.TreeItem {
  constructor(
    public readonly item: ProblemListItem,
    status: ProblemStatus | undefined,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(`${item.id}. ${item.title}`, collapsibleState);
    const statusSuffix =
      status === "solved" ? " • ✓" : status === "attempting" ? " • Attempting" : "";
    this.description = `${item.difficulty}${statusSuffix}`;
    this.tooltip = item.titleSlug;
    if (status === "solved") {
      this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    } else if (status === "attempting") {
      this.iconPath = new vscode.ThemeIcon("debug-start", new vscode.ThemeColor("editorWarning.foreground"));
    }
  }
}

export class CategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly category: string,
    public readonly problems: ProblemListItem[]
  ) {
    super(category, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `${category} (${problems.length} problems)`;
  }
}

export type ProblemTreeElement = ProblemTreeItem | CategoryTreeItem;

function isCategoryTreeItem(el: ProblemTreeElement): el is CategoryTreeItem {
  return el instanceof CategoryTreeItem;
}

function isStudyPlanGroup(obj: unknown): obj is StudyPlanGroup {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "category" in obj &&
    "problems" in obj &&
    Array.isArray((obj as StudyPlanGroup).problems)
  );
}

export class ProblemsTreeProvider implements vscode.TreeDataProvider<ProblemTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private list: ProblemListItem[] = [];
  private groups: StudyPlanGroup[] = [];
  private leetcode = new LeetCodeProvider();
  private listKind: ProblemListKind;
  private memento: vscode.Memento;
  private filterDifficulty: string | undefined;
  private filterTitle: string | undefined;
  private storagePath: string;
  private listSource: "problemset" | NonProblemsetListSource;
  private problemListCategoryLabel: string | undefined;
  private getCookie?: () => string | undefined;

  constructor(
    listKind: ProblemListKind,
    memento: vscode.Memento,
    storagePath: string,
    options?: ProblemsTreeProviderOptions
  ) {
    this.listKind = listKind;
    this.memento = memento;
    this.storagePath = storagePath;
    this.listSource =
      listKind === "problemset" ? "problemset" : (options?.initialListSource ?? "studyPlan");
    this.problemListCategoryLabel = options?.problemListCategoryLabel;
    this.getCookie = options?.getCookie;
  }

  private get cachePath(): string {
    return path.join(
      this.storagePath,
      this.listKind === "problemset" ? "problemset-cache.json" : `${this.listKind}-cache.json`
    );
  }

  /**
   * Switch study plan or problem-list slug (only when listKind is not problemset).
   * For problem-list providers, pass display name for the tree category when known.
   */
  setPlanSlug(slug: string, problemListDisplayName?: string): void {
    if (this.listKind === "problemset") return;
    this.listKind = slug;
    if (problemListDisplayName !== undefined) {
      this.problemListCategoryLabel = problemListDisplayName;
    }
    this.groups = [];
    this.refresh();
  }

  setFilter(difficulty?: string, title?: string): void {
    this.filterDifficulty = difficulty && difficulty !== "All" ? difficulty : undefined;
    this.filterTitle = title?.trim() || undefined;
    this._onDidChangeTreeData.fire();
  }

  invalidate(): void {
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.list = [];
    this.groups = [];
    if (this.cachePath && fs.existsSync(this.cachePath)) {
      try {
        fs.unlinkSync(this.cachePath);
      } catch {
        /* ignore */
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProblemTreeElement): vscode.TreeItem {
    return element;
  }

  private applyFilters(items: ProblemListItem[]): ProblemListItem[] {
    let result = items;
    if (this.filterDifficulty) {
      result = result.filter((item) => item.difficulty === this.filterDifficulty);
    }
    if (this.filterTitle) {
      const lower = this.filterTitle.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(lower) ||
          item.titleSlug.toLowerCase().includes(lower)
      );
    }
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    const isStudyPlan = this.listKind !== "problemset";
    if (isStudyPlan) {
      const planSlug = this.listKind;
      if (this.groups.length === 0 && fs.existsSync(this.cachePath)) {
        try {
          const raw = fs.readFileSync(this.cachePath, "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0 && isStudyPlanGroup(parsed[0])) {
            const cached = parsed as StudyPlanGroup[];
            const isStaleGeneralCache =
              cached.length === 1 && cached[0].category === "General";
            if (!isStaleGeneralCache) {
              this.groups = cached;
            }
          }
        } catch {
          this.groups = [];
        }
      }
      if (this.groups.length === 0) {
        if (this.listSource === "problemList") {
          if (!planSlug || planSlug === NO_PROBLEM_LIST_SENTINEL) {
            this.groups = [];
          } else {
          const cookie = this.getCookie?.();
          const problems = await this.leetcode.getFavoriteProblemList(planSlug, cookie);
          const category =
            this.problemListCategoryLabel?.trim() || slugToTitle(planSlug);
          this.groups = problems.length > 0 ? [{ category, problems }] : [];
          }
        } else {
          this.groups = await this.leetcode.getStudyPlanProblemListGrouped(planSlug);
        }
        if (this.groups.length > 0) {
          try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.groups), "utf-8");
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      if (this.list.length === 0 && fs.existsSync(this.cachePath)) {
        try {
          const raw = fs.readFileSync(this.cachePath, "utf-8");
          this.list = JSON.parse(raw) as ProblemListItem[];
        } catch {
          this.list = [];
        }
      }
      if (this.list.length === 0) {
        this.list = await this.leetcode.getFullProblemsetList();
        if (this.list.length > 0) {
          try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.list), "utf-8");
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  async getChildren(element?: ProblemTreeElement): Promise<ProblemTreeElement[]> {
    if (element && isCategoryTreeItem(element)) {
      const filtered = this.applyFilters(element.problems);
      return filtered.map((item) => {
        const status = getStoredStatus(this.memento, item.titleSlug);
        return new ProblemTreeItem(item, status);
      });
    }
    await this.ensureLoaded();
    if (this.listKind !== "problemset") {
      const result: CategoryTreeItem[] = [];
      for (const g of this.groups) {
        const filtered = this.applyFilters(g.problems);
        if (filtered.length > 0) {
          result.push(new CategoryTreeItem(g.category, filtered));
        }
      }
      return result;
    }
    const filtered = this.applyFilters(this.list);
    return filtered.map((item) => {
      const status = getStoredStatus(this.memento, item.titleSlug);
      return new ProblemTreeItem(item, status);
    });
  }

  /** Returns the current list (loaded and filtered). Used by random picker and stats. */
  async getProblemList(): Promise<ProblemListItem[]> {
    await this.ensureLoaded();
    if (this.listKind !== "problemset") {
      const flat = this.groups.flatMap((g) => g.problems);
      return this.applyFilters(flat);
    }
    return this.applyFilters(this.list);
  }
}
