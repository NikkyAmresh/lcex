import type { ProblemConstraints } from "./ConstraintParser";
import type { SupportedLanguage } from "./interface/Problem";

export interface Budget {
  maxSize: number;
  maxSizeLabel: string;
  targetDepth: number;
  targetLabel: string;
}

export interface LoopPosition {
  line: number;
  depth: number;
}

export interface ComplexityEstimate {
  maxDepth: number;
  loops: LoopPosition[];
  hasSort: boolean;
}

export type Tone = "ok" | "tight" | "over" | "unknown";

export interface Verdict {
  tone: Tone;
  icon: "🟢" | "🟡" | "🔴" | "⚪";
  estimateLabel: string;
}

const SIZE_PARAM_NAMES = new Set(["n", "m", "k", "q", "len", "size", "length"]);

function isSizeParam(name: string): boolean {
  if (/\.length$/i.test(name)) return true;
  const bare = name.toLowerCase();
  return SIZE_PARAM_NAMES.has(bare);
}

function formatSize(n: number): string {
  if (n === 1e9) return "10⁹";
  if (n === 1e8) return "10⁸";
  if (n === 1e7) return "10⁷";
  if (n === 1e6) return "10⁶";
  if (n === 1e5) return "10⁵";
  if (n === 1e4) return "10⁴";
  if (n === 1e3) return "10³";
  if (n >= 1e9) return `${(n / 1e9).toFixed(0)}·10⁹`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}·10⁶`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(0)}·10⁵`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}·10⁴`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function deriveBudget(constraints: ProblemConstraints): Budget | null {
  let maxSize = 0;
  for (const [name, c] of constraints.byName) {
    if (!isSizeParam(name)) continue;
    if (c.max !== undefined && c.max > maxSize) maxSize = c.max;
  }
  if (maxSize <= 0) return null;
  const maxSizeLabel = `n≤${formatSize(maxSize)}`;

  if (maxSize <= 12) return { maxSize, maxSizeLabel, targetDepth: 99, targetLabel: "O(n!) / O(2ⁿ) all fine" };
  if (maxSize <= 22) return { maxSize, maxSizeLabel, targetDepth: 99, targetLabel: "O(2ⁿ) fine" };
  if (maxSize <= 500) return { maxSize, maxSizeLabel, targetDepth: 3, targetLabel: "O(n³)" };
  if (maxSize <= 5000) return { maxSize, maxSizeLabel, targetDepth: 2, targetLabel: "O(n²)" };
  if (maxSize <= 1e5) return { maxSize, maxSizeLabel, targetDepth: 1, targetLabel: "O(n log n)" };
  return { maxSize, maxSizeLabel, targetDepth: 1, targetLabel: "O(n)" };
}

const SINGLE_LINE_COMMENT: Record<SupportedLanguage, RegExp> = {
  python: /^\s*#/,
  typescript: /^\s*\/\//,
  javascript: /^\s*\/\//,
  cpp: /^\s*\/\//,
};

function isLoopStart(line: string): boolean {
  return /^\s*(?:for|while)\s*[\s(]/.test(line);
}

/** Indent-based loop nesting estimate. Works on well-indented code across all four languages. */
export function estimateLoopNesting(source: string, lang: SupportedLanguage): ComplexityEstimate {
  const lines = source.split("\n");
  const loops: LoopPosition[] = [];
  const stack: number[] = [];
  let maxDepth = 0;
  let hasSort = false;
  const commentRe = SINGLE_LINE_COMMENT[lang];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (commentRe.test(raw)) continue;

    const indent = /^(\s*)/.exec(raw)?.[1].length ?? 0;
    while (stack.length > 0 && indent <= stack[stack.length - 1]) {
      stack.pop();
    }

    if (isLoopStart(raw)) {
      stack.push(indent);
      const d = stack.length;
      loops.push({ line: i, depth: d });
      if (d > maxDepth) maxDepth = d;
    }

    if (!hasSort && /\.sort\s*\(/.test(raw)) hasSort = true;
  }

  return { maxDepth, loops, hasSort };
}

export function formatEstimate(estimate: ComplexityEstimate): string {
  const d = estimate.maxDepth;
  let base: string;
  if (d === 0) base = "O(1) / no loops detected";
  else if (d === 1) base = "O(n)";
  else if (d === 2) base = "O(n²)";
  else if (d === 3) base = "O(n³)";
  else base = `O(n^${d})`;
  if (estimate.hasSort && d <= 1) return "O(n log n)";
  if (estimate.hasSort) return `${base} · +sort`;
  return base;
}

export function compareToBudget(
  estimate: ComplexityEstimate,
  budget: Budget | null
): Verdict {
  const estimateLabel = formatEstimate(estimate);
  if (!budget) {
    return { tone: "unknown", icon: "⚪", estimateLabel };
  }
  const delta = estimate.maxDepth - budget.targetDepth;
  if (delta <= 0) {
    return { tone: "ok", icon: "🟢", estimateLabel };
  }
  // For large-n problems, even one extra depth means TLE territory.
  // For small-n (< 10^4), one extra depth is genuinely marginal.
  const LARGE_N = 1e4;
  if (delta === 1 && budget.maxSize < LARGE_N) {
    return { tone: "tight", icon: "🟡", estimateLabel };
  }
  return { tone: "over", icon: "🔴", estimateLabel };
}

export interface ComplexityInlineItem {
  line: number;
  text: string;
  severity: "muted" | "info" | "success" | "warning" | "error";
  hoverMarkdown?: string;
}

export function buildComplexityInlineItems(
  signatureLine: number,
  estimate: ComplexityEstimate,
  budget: Budget | null
): ComplexityInlineItem[] {
  const verdict = compareToBudget(estimate, budget);
  const signatureText = budget
    ? `  ${verdict.icon} ${budget.maxSizeLabel} · target ${budget.targetLabel} · est ${verdict.estimateLabel}`
    : `  ⚪ no size constraint parsed · est ${verdict.estimateLabel}`;
  const sigSeverity: ComplexityInlineItem["severity"] =
    verdict.tone === "ok" ? "success"
      : verdict.tone === "tight" ? "warning"
        : verdict.tone === "over" ? "error"
          : "muted";

  const items: ComplexityInlineItem[] = [
    {
      line: signatureLine,
      text: signatureText,
      severity: sigSeverity,
      hoverMarkdown: buildHover(estimate, budget, verdict),
    },
  ];

  for (const loop of estimate.loops) {
    if (loop.line === signatureLine) continue;
    let loopSeverity: ComplexityInlineItem["severity"] = "muted";
    if (budget) {
      const delta = loop.depth - budget.targetDepth;
      if (delta > 0) {
        const isLargeN = budget.maxSize >= 1e4;
        loopSeverity = delta === 1 && !isLargeN ? "warning" : "error";
      }
    }
    const tag = `  nest ${loop.depth}× → O(n${loop.depth === 1 ? "" : superscript(loop.depth)})`;
    items.push({ line: loop.line, text: tag, severity: loopSeverity });
  }

  return items;
}

function superscript(n: number): string {
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return String(n).split("").map((c) => map[c] ?? c).join("");
}

function buildHover(estimate: ComplexityEstimate, budget: Budget | null, verdict: Verdict): string {
  const lines: string[] = ["**lcex: complexity budget**", ""];
  if (budget) {
    lines.push(`- size cap: \`${budget.maxSizeLabel}\` (max ${formatSize(budget.maxSize)})`);
    lines.push(`- target: \`${budget.targetLabel}\``);
  } else {
    lines.push(`- size cap: _not detected in problem constraints_`);
  }
  lines.push(`- estimate: \`${verdict.estimateLabel}\` ${verdict.icon}`);
  lines.push(`- detected loop nesting: max depth **${estimate.maxDepth}**${estimate.hasSort ? " · `.sort()` present" : ""}`);
  lines.push("", "_Heuristic: counts nested `for`/`while` by indent. Recursive depth is not yet modeled._");
  return lines.join("\n");
}
