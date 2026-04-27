import { analyzeComplexity } from "./complexity/Engine";
import type { Confidence, Hotspot } from "./complexity/IR";
import type { ProblemConstraints } from "./ConstraintParser";
import type { SupportedLanguage } from "./interface/Problem";

export interface Budget {
  maxSize: number;
  maxSizeLabel: string;
  targetDepth: number;
  targetLabel: string;
}

/**
 * Loop position used by the inline-decoration builder. We keep the field
 * for backward compatibility with hover formatting; the new engine populates
 * it with hotspot lines (loop heads, expensive call sites).
 */
export interface LoopPosition {
  line: number;
  depth: number;
}

export interface ComplexityEstimate {
  /** Numeric depth used to compare to budget.targetDepth (1 = O(n) or O(n log n), 2 = O(n²), etc.). */
  maxDepth: number;
  /** Hotspot lines for inline decorations (one item per loop / dominant call). */
  loops: LoopPosition[];
  /** True when the depth-1 estimate carries a log factor (n log n vs n). */
  hasLogFactor: boolean;
  /** Compatibility shim: true iff a sort builtin contributed. */
  hasSort: boolean;
  /** Confidence in the verdict: high / medium / low. */
  confidence: Confidence;
  /** Big-O label, e.g. "O(n log n)" / "O(n²)" / "O(V+E)". */
  bigO: string;
  /** Hotspot details for hover reasoning. */
  hotspots: Hotspot[];
  /** Human-readable reasoning bullets, one per non-trivial step. */
  reasoning: string[];
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

/**
 * Static complexity analysis entry point. Replaces the previous indent-only
 * loop-counting heuristic with a structured AST-lite analyzer that classifies
 * loop bounds, recognizes amortized patterns (two-pointer / sliding-window /
 * monotonic-stack), and applies Master-theorem reasoning to recursion.
 *
 * The function name is preserved for callers and tests.
 */
export function estimateLoopNesting(source: string, lang: SupportedLanguage): ComplexityEstimate {
  const result = analyzeComplexity(source, lang);
  const loops: LoopPosition[] = result.hotspots
    .filter((h) => /^(for|while)/.test(h.label))
    .map((h) => ({ line: h.line, depth: depthFromLabel(h.contributesO) }));
  return {
    maxDepth: result.depth,
    loops,
    hasLogFactor: result.hasLogFactor,
    hasSort: /n log n/.test(result.bigO) || result.reasoning.some((r) => /sort/i.test(r)),
    confidence: result.confidence,
    bigO: result.bigO,
    hotspots: result.hotspots,
    reasoning: result.reasoning,
  };
}

function depthFromLabel(big: string): number {
  if (/n³/.test(big)) return 3;
  if (/n²/.test(big)) return 2;
  if (/n log n/.test(big) || /^O\(n\)$/.test(big) || /V\+E/.test(big)) return 1;
  return 0;
}

export function formatEstimate(estimate: ComplexityEstimate): string {
  return estimate.bigO;
}

export function compareToBudget(
  estimate: ComplexityEstimate,
  budget: Budget | null,
): Verdict {
  const estimateLabel = formatEstimate(estimate);
  if (!budget) {
    return { tone: "unknown", icon: "⚪", estimateLabel };
  }
  const delta = estimate.maxDepth - budget.targetDepth;

  // Confidence-aware severity capping: when the engine couldn't classify
  // a loop, never escalate to "over" — show "tight" with hover saying so.
  if (estimate.confidence === "low") {
    if (delta <= 0) return { tone: "ok", icon: "🟢", estimateLabel };
    return { tone: "tight", icon: "🟡", estimateLabel };
  }

  if (delta < 0) {
    return { tone: "ok", icon: "🟢", estimateLabel };
  }
  if (delta === 0) {
    // Same depth — check for log-factor mismatches that matter for large n.
    // E.g., target O(n log n) vs estimate O(n²) → already delta=1 (not here).
    // Target O(n) vs estimate O(n log n): same depth=1 but estimate has log factor.
    if (
      budget.targetDepth === 1
      && /^O\(n\)$/.test(budget.targetLabel)
      && estimate.hasLogFactor
      && budget.maxSize > 1e5
    ) {
      return { tone: "tight", icon: "🟡", estimateLabel };
    }
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
  budget: Budget | null,
): ComplexityInlineItem[] {
  const verdict = compareToBudget(estimate, budget);
  const confidenceTag =
    estimate.confidence === "low"
      ? " · low confidence"
      : estimate.confidence === "medium"
        ? " · medium confidence"
        : "";
  const signatureText = budget
    ? `  ${verdict.icon} ${budget.maxSizeLabel} · target ${budget.targetLabel} · est ${verdict.estimateLabel}${confidenceTag}`
    : `  ⚪ no size constraint parsed · est ${verdict.estimateLabel}${confidenceTag}`;
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

  // Hotspot decorations on each loop / expensive call line. Severity is
  // driven by the loop's nest depth vs. the budget's target depth, so the
  // depth-2 loop in a target-O(n) problem is flagged red while a constant-
  // bounded inner doesn't add depth and stays muted.
  const seenLines = new Set<number>([signatureLine]);
  for (const h of estimate.hotspots) {
    if (seenLines.has(h.line)) continue;
    seenLines.add(h.line);
    let severity: ComplexityInlineItem["severity"] = "muted";
    if (budget && estimate.confidence !== "low") {
      const isLargeN = budget.maxSize >= 1e4;
      if (h.nestDepth != null) {
        const delta = h.nestDepth - budget.targetDepth;
        if (delta > 0) severity = isLargeN ? "error" : "warning";
        else if (/amortized/i.test(h.contributesO)) severity = "success";
      } else {
        // calls/recursion: rank by the call's contributesO
        if (/n²/.test(h.contributesO) && budget.targetDepth < 2) severity = isLargeN ? "error" : "warning";
        else if (/n³/.test(h.contributesO) && budget.targetDepth < 3) severity = isLargeN ? "error" : "warning";
      }
    }
    items.push({
      line: h.line,
      text: `  ↳ ${h.label}`,
      severity,
    });
  }

  return items;
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
  lines.push(`- confidence: **${estimate.confidence}**`);
  if (estimate.reasoning.length > 0) {
    lines.push("", "**reasoning**");
    for (const r of estimate.reasoning) lines.push(`- ${r}`);
  }
  if (estimate.confidence === "low") {
    lines.push("", "_Tentative: at least one loop's bound could not be classified statically — severity is capped at 🟡._");
  }
  lines.push(
    "",
    "_Static heuristic: classifies loop bounds (const / log / linear / amortized), recognizes two-pointer / sliding-window / monotonic-stack, and applies Master-theorem reasoning to self-recursion. Falls back to low confidence on novel patterns rather than guessing._",
  );
  return lines.join("\n");
}
