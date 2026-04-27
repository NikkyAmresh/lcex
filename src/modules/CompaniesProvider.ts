import * as vscode from "vscode";
import type { ProblemListItem } from "./LeetCode";
import { getStoredStatus, type ProblemStatus } from "./ProblemsProvider";
import {
  invalidateCompaniesDataset,
  loadCompaniesDataset,
  type CompanyDataset,
} from "./CompaniesData";

interface CompanyProblem {
  company: string;
  slug: string;
  title: string;
  difficulty: string;
  difficultyKey: "EASY" | "MEDIUM" | "HARD" | "UNKNOWN";
  accept: number;
  freq: number;
  topics: string[];
}

function difficultyKey(raw: string): CompanyProblem["difficultyKey"] {
  const u = (raw ?? "").toUpperCase();
  if (u === "EASY" || u === "MEDIUM" || u === "HARD") return u;
  return "UNKNOWN";
}

function shortDifficulty(key: CompanyProblem["difficultyKey"]): string {
  if (key === "EASY") return "Easy";
  if (key === "MEDIUM") return "Med";
  if (key === "HARD") return "Hard";
  return "?";
}

function difficultyIcon(key: CompanyProblem["difficultyKey"]): vscode.ThemeIcon {
  if (key === "EASY") {
    return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
  }
  if (key === "MEDIUM") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("editorWarning.foreground")
    );
  }
  if (key === "HARD") {
    return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconFailed"));
  }
  return new vscode.ThemeIcon("circle-outline");
}

export class CompanyTreeItem extends vscode.TreeItem {
  constructor(public readonly name: string, count: number) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "lcex.company";
    this.description = String(count);
    this.tooltip = `${name} — ${count} problems`;
    this.iconPath = new vscode.ThemeIcon("organization");
  }
}

export class CompanyProblemTreeItem extends vscode.TreeItem {
  /** ProblemListItem-shaped view for compatibility with markAsSolved / openProblemWebview. */
  public readonly item: ProblemListItem;

  constructor(public readonly problem: CompanyProblem, status: ProblemStatus | undefined) {
    super(problem.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "lcex.companyProblem";
    const dKey = problem.difficultyKey;
    const difficulty =
      dKey === "EASY"
        ? "Easy"
        : dKey === "MEDIUM"
          ? "Medium"
          : dKey === "HARD"
            ? "Hard"
            : "Unknown";
    this.item = {
      id: "",
      titleSlug: problem.slug,
      title: problem.title,
      difficulty,
    };
    const diff = shortDifficulty(dKey);
    const freq = `${problem.freq.toFixed(0)}%`;
    const accept = `${Math.round(problem.accept * 100)}%`;
    const statusSuffix =
      status === "solved" ? " · ✓" : status === "attempting" ? " · ◐" : "";
    this.description = `${diff} · ${freq} · ${accept}${statusSuffix}`;
    this.tooltip = problem.topics.length > 0 ? problem.topics.join(", ") : problem.slug;
    if (status === "solved") {
      this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    } else if (status === "attempting") {
      this.iconPath = new vscode.ThemeIcon(
        "debug-start",
        new vscode.ThemeColor("editorWarning.foreground")
      );
    } else {
      this.iconPath = difficultyIcon(dKey);
    }
  }
}

export type CompaniesTreeElement = CompanyTreeItem | CompanyProblemTreeItem;

export class CompaniesTreeProvider implements vscode.TreeDataProvider<CompaniesTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filterDifficulty: "EASY" | "MEDIUM" | "HARD" | undefined;
  private filterQuery: string | undefined;

  constructor(
    private readonly extensionPath: string,
    private readonly memento: vscode.Memento
  ) {}

  private ensureLoaded(): CompanyDataset | null {
    return loadCompaniesDataset(this.extensionPath);
  }

  refresh(): void {
    invalidateCompaniesDataset();
    this._onDidChangeTreeData.fire();
  }

  invalidate(): void {
    this._onDidChangeTreeData.fire();
  }

  setDifficultyFilter(d: string | undefined): void {
    const u = (d ?? "").toUpperCase();
    this.filterDifficulty =
      u === "EASY" || u === "MEDIUM" || u === "HARD" ? u : undefined;
    this._onDidChangeTreeData.fire();
  }

  setQueryFilter(q: string | undefined): void {
    this.filterQuery = q?.trim().toLowerCase() || undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CompaniesTreeElement): vscode.TreeItem {
    return element;
  }

  private problemsForCompany(name: string): CompanyProblem[] {
    const data = this.ensureLoaded();
    if (!data) return [];
    const edges = data.companies[name] ?? [];
    const out: CompanyProblem[] = [];
    for (const edge of edges) {
      const p = data.problems[edge.i];
      if (!p) continue;
      const dKey = difficultyKey(p.difficulty);
      out.push({
        company: name,
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        difficultyKey: dKey,
        accept: p.accept,
        freq: edge.freq,
        topics: p.topics,
      });
    }
    return out;
  }

  private applyFilter(items: CompanyProblem[]): CompanyProblem[] {
    let result = items;
    if (this.filterDifficulty) {
      result = result.filter((p) => p.difficultyKey === this.filterDifficulty);
    }
    if (this.filterQuery) {
      const q = this.filterQuery;
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.topics.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }

  async getChildren(element?: CompaniesTreeElement): Promise<CompaniesTreeElement[]> {
    const data = this.ensureLoaded();
    if (!data) return [];

    if (!element) {
      const q = this.filterQuery;
      const out: CompanyTreeItem[] = [];
      for (const name of Object.keys(data.companies)) {
        const all = this.problemsForCompany(name);
        const byDifficulty = this.filterDifficulty
          ? all.filter((p) => p.difficultyKey === this.filterDifficulty)
          : all;
        const filtered = this.applyFilter(byDifficulty);
        // Include if any problem matches OR the company name itself matches the query.
        if (filtered.length > 0) {
          out.push(new CompanyTreeItem(name, filtered.length));
        } else if (q && name.toLowerCase().includes(q) && byDifficulty.length > 0) {
          out.push(new CompanyTreeItem(name, byDifficulty.length));
        }
      }
      out.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      return out;
    }

    if (element instanceof CompanyTreeItem) {
      const filtered = this.applyFilter(this.problemsForCompany(element.name));
      return filtered.map(
        (p) => new CompanyProblemTreeItem(p, getStoredStatus(this.memento, p.slug))
      );
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
