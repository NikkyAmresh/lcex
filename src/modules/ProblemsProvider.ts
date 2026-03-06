import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LeetCodeProvider, type ProblemListItem } from "./LeetCode";
const STATUS_KEY = "leetcode-practice.problemStatus";

export type ProblemStatus = "solved" | "attempting";

export type ProblemListKind = "problemset" | "top-interview-150";

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

export class ProblemsTreeProvider implements vscode.TreeDataProvider<ProblemTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private list: ProblemListItem[] = [];
  private leetcode = new LeetCodeProvider();
  private listKind: ProblemListKind;
  private memento: vscode.Memento;
  private filterDifficulty: string | undefined;
  private filterTitle: string | undefined;
  private cachePath: string | undefined;

  constructor(listKind: ProblemListKind, memento: vscode.Memento, cachePath?: string) {
    this.listKind = listKind;
    this.memento = memento;
    this.cachePath = cachePath;
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
    if (this.cachePath && fs.existsSync(this.cachePath)) {
      try {
        fs.unlinkSync(this.cachePath);
      } catch {
        /* ignore */
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProblemTreeItem): vscode.TreeItem {
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

  async getChildren(): Promise<ProblemTreeItem[]> {
    if (this.list.length === 0) {
      if (this.cachePath && fs.existsSync(this.cachePath)) {
        try {
          const raw = fs.readFileSync(this.cachePath, "utf-8");
          this.list = JSON.parse(raw) as ProblemListItem[];
        } catch {
          this.list = [];
        }
      }
      if (this.list.length === 0) {
        this.list =
          this.listKind === "top-interview-150"
            ? await this.leetcode.getStudyPlanProblemList("top-interview-150")
            : await this.leetcode.getFullProblemsetList();
        if (this.cachePath && this.list.length > 0) {
          try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.list), "utf-8");
          } catch {
            /* ignore */
          }
        }
      }
    }
    const filtered = this.applyFilters(this.list);
    return filtered.map((item) => {
      const status = getStoredStatus(this.memento, item.titleSlug);
      return new ProblemTreeItem(item, status);
    });
  }

  /** Returns the current list (loaded and filtered). Used by random picker and stats. */
  async getProblemList(): Promise<ProblemListItem[]> {
    if (this.list.length === 0) {
      if (this.cachePath && fs.existsSync(this.cachePath)) {
        try {
          const raw = fs.readFileSync(this.cachePath, "utf-8");
          this.list = JSON.parse(raw) as ProblemListItem[];
        } catch {
          this.list = [];
        }
      }
      if (this.list.length === 0) {
        this.list =
          this.listKind === "top-interview-150"
            ? await this.leetcode.getStudyPlanProblemList("top-interview-150")
            : await this.leetcode.getFullProblemsetList();
        if (this.cachePath && this.list.length > 0) {
          try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.list), "utf-8");
          } catch {
            /* ignore */
          }
        }
      }
    }
    return this.applyFilters(this.list);
  }
}
