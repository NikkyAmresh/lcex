import type { SupportedLanguage } from "../interface/Problem";

/** Logical "size" of a loop's iteration count. */
export type Bound =
  | { kind: "const"; k: number }
  | { kind: "log"; size?: string }
  | { kind: "sqrt"; size?: string }
  | { kind: "linear"; size?: string }
  | { kind: "amortized"; size?: string; reason: string }
  | { kind: "unknown" };

export interface Span {
  /** 0-indexed start line. */
  startLine: number;
  /** 0-indexed end line, inclusive. */
  endLine: number;
  /** column where the head/keyword begins, 0-indexed. */
  startColumn: number;
}

export interface LoopNode {
  kind: "for" | "while";
  span: Span;
  /** Raw header text after the keyword, trimmed. e.g. "(let i=0; i<n; i++)" or "i in range(n)". */
  headerText: string;
  /** Concatenated body text, used for inspection. */
  bodyText: string;
  /** Loops directly nested in this loop's body. */
  loops: LoopNode[];
  /** Calls that appear in this loop body (including nested loops, but each call attributed once). */
  calls: CallNode[];
  /** Filled in by LoopBound classifier. */
  bound?: Bound;
  /** Filled in by AmortizedPatterns when this loop participates in an amortized pattern. */
  amortizedTag?: string;
}

export interface CallNode {
  /** Resolved-ish call name. e.g. "heapq.heappush", "Array.includes", "Math.floor", "self.dfs". */
  name: string;
  /** Raw call expression text. */
  raw: string;
  line: number;
  /** Whether this call is to the enclosing function (self-recursive). */
  isSelfCall?: boolean;
}

export interface FuncNode {
  name: string;
  span: Span;
  params: string[];
  /** Top-level loops in this function (outermost). */
  loops: LoopNode[];
  /** All calls in this function (across all nesting). */
  calls: CallNode[];
  /** Body text, indent-stripped to function level. */
  bodyText: string;
  /** Detected by RecursionAnalyzer. */
  isRecursive?: boolean;
  /** Filled by RecursionAnalyzer when recurrence matches a known template. */
  recurrenceTag?: string;
}

export interface ProgramIR {
  lang: SupportedLanguage;
  source: string;
  functions: FuncNode[];
}

export type Confidence = "high" | "medium" | "low";

export interface Hotspot {
  line: number;
  label: string;
  /** What this contributes to the overall asymptotic, for hover reasoning. */
  contributesO: string;
  /** Nest depth (1 = top-level loop, 2 = inner, …). Calls/recursion → 0. */
  nestDepth?: number;
  /** Cumulative complexity class at this point, e.g. "linear", "quadratic" — used for severity coloring. */
  cumulativeClass?: string;
}

export interface ComplexityResult {
  /** e.g., "O(n)", "O(n log n)", "O(n²)", "O(1)", "O(2ⁿ)" */
  bigO: string;
  /** Numeric depth used to compare to budget.targetDepth. 0 = O(1), 1 = O(n) (incl. n log n), 2 = O(n²), etc. */
  depth: number;
  /** True if the depth-1 estimate is actually n log n (so it costs slightly more than pure linear). */
  hasLogFactor: boolean;
  confidence: Confidence;
  hotspots: Hotspot[];
  reasoning: string[];
}
