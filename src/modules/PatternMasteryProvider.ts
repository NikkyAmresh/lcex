import * as vscode from "vscode";
import {
  pickWeakestPattern,
  summarizePatternMastery,
  type PatternMasterySummary,
} from "./PatternMastery";

/**
 * Sidebar tree view of the canonical interview-pattern mastery dashboard.
 * Expanding a pattern node shows its solved count, last-solved age, and a
 * "Practice this pattern" action.
 */
export class PatternMasteryTreeProvider implements vscode.TreeDataProvider<PatternMasteryNode> {
  private readonly _changed = new vscode.EventEmitter<PatternMasteryNode | undefined>();
  readonly onDidChangeTreeData = this._changed.event;

  constructor(private readonly memento: vscode.Memento) {}

  refresh(): void {
    this._changed.fire(undefined);
  }

  getTreeItem(node: PatternMasteryNode): vscode.TreeItem {
    return node.toTreeItem();
  }

  getChildren(node?: PatternMasteryNode): PatternMasteryNode[] {
    if (!node) {
      const out: PatternMasteryNode[] = [];
      const weakest = pickWeakestPattern(this.memento);
      if (weakest) {
        out.push(new SuggestionNode(weakest));
      }
      const summary = summarizePatternMastery(this.memento);
      for (const s of summary) {
        out.push(new PatternRowNode(s));
      }
      return out;
    }
    return node.children();
  }
}

abstract class PatternMasteryNode {
  abstract toTreeItem(): vscode.TreeItem;
  abstract children(): PatternMasteryNode[];
}

class SuggestionNode extends PatternMasteryNode {
  constructor(private readonly summary: PatternMasterySummary) {
    super();
  }
  toTreeItem(): vscode.TreeItem {
    const label = `Suggested next: ${this.summary.label}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("rocket");
    item.tooltip = new vscode.MarkdownString(
      `**${this.summary.icon} ${this.summary.label}**\n\n${this.summary.blurb}\n\n_${rankText(this.summary)}_`,
    );
    item.contextValue = "patternMasterySuggestion";
    item.command = {
      title: "Practice this pattern",
      command: "leetcode-practice.practicePattern",
      arguments: [this.summary.patternId, this.summary.leetcodeTag],
    };
    return item;
  }
  children(): PatternMasteryNode[] {
    return [];
  }
}

class PatternRowNode extends PatternMasteryNode {
  constructor(private readonly summary: PatternMasterySummary) {
    super();
  }
  toTreeItem(): vscode.TreeItem {
    const bar = renderBar(this.summary.masteryScore);
    const label = `${this.summary.icon}  ${this.summary.label}`;
    const desc = `${bar}  ${this.summary.solvedCount} solved`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = desc;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${this.summary.icon} ${this.summary.label}**`,
        "",
        this.summary.blurb,
        "",
        rankText(this.summary),
      ].join("\n"),
    );
    item.contextValue = `patternMastery.${this.summary.rank}`;
    item.command = {
      title: "Practice this pattern",
      command: "leetcode-practice.practicePattern",
      arguments: [this.summary.patternId, this.summary.leetcodeTag],
    };
    return item;
  }
  children(): PatternMasteryNode[] {
    return [new PatternStatNode(this.summary)];
  }
}

class PatternStatNode extends PatternMasteryNode {
  constructor(private readonly summary: PatternMasterySummary) {
    super();
  }
  toTreeItem(): vscode.TreeItem {
    let detail: string;
    if (this.summary.solvedCount === 0) {
      detail = "Never solved a problem with this pattern. Try one!";
    } else {
      const days = this.summary.daysSinceLastSolve;
      const ago = days < 1 ? "today" : days < 2 ? "yesterday" : `${Math.round(days)}d ago`;
      detail = `Last solved ${ago} • mastery ${(this.summary.masteryScore * 100).toFixed(0)}%`;
    }
    const item = new vscode.TreeItem(detail, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(iconFor(this.summary.rank));
    return item;
  }
  children(): PatternMasteryNode[] {
    return [];
  }
}

function rankText(s: PatternMasterySummary): string {
  switch (s.rank) {
    case "untouched":
      return "✗ Untouched — adding this to your repertoire is the highest-impact move.";
    case "rusty":
      return "·  Rusty — solved before but it's been a while.";
    case "practiced":
      return "→ Practiced — you've seen this enough to recognise it.";
    case "strong":
      return "🔥 Strong — comfortable territory.";
  }
}

function iconFor(rank: PatternMasterySummary["rank"]): string {
  switch (rank) {
    case "untouched":
      return "circle-outline";
    case "rusty":
      return "circle-slash";
    case "practiced":
      return "circle-filled";
    case "strong":
      return "verified";
  }
}

/** Renders a 10-cell ASCII progress bar. */
function renderBar(score: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}
