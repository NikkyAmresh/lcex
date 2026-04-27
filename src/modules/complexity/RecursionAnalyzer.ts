import type { SupportedLanguage } from "../interface/Problem";
import type { CallNode, FuncNode, LoopNode } from "./IR";

/**
 * Per-function recursion analysis.
 *
 * Records:
 *   - whether the function is self-recursive
 *   - if so, what recurrence template it most closely matches
 *
 * The Engine uses this to override the loop-based depth estimate for
 * recursive functions where the recurrence dominates.
 *
 * Returns an asymptotic class for the recursive function:
 *   - "constant"      → O(1) (degenerate)
 *   - "log"           → O(log n)            (T(n)=T(n/2)+O(1))
 *   - "linear"        → O(n)                (T(n)=T(n-1)+O(1) or T(n/2)+O(n) etc.)
 *   - "linearithmic"  → O(n log n)          (T(n)=2T(n/2)+O(n))
 *   - "quadratic"     → O(n²)               (T(n)=T(n-1)+O(n))
 *   - "exponential"   → O(2^n)              (two recursive calls without halving)
 *   - "graph"         → O(V+E)              (DFS guarded by visited set)
 *   - null            → recursion not classified (caller falls back to loops)
 *
 * `loopWorkClass` is the per-call non-recursive work, derived from the function's loops
 * by the Engine before calling here. Pass:
 *   "const" | "log" | "linear" | "linearithmic" | "quadratic"
 */
export type RecursionClass =
  | "constant"
  | "log"
  | "linear"
  | "linearithmic"
  | "quadratic"
  | "exponential"
  | "graph";

export type LoopWorkClass = "const" | "log" | "linear" | "linearithmic" | "quadratic" | "unknown";

export function analyzeRecursion(
  fn: FuncNode,
  loopWorkClass: LoopWorkClass,
  lang: SupportedLanguage,
): { class: RecursionClass | null; reason: string } {
  const selfCalls = collectSelfCalls(fn);
  if (selfCalls.length === 0) return { class: null, reason: "" };
  fn.isRecursive = true;

  const a = countRecursiveCalls(fn);
  const isHalving = anyArgIsHalving(selfCalls, fn);
  const isDecrement = anyArgIsDecrement(selfCalls, fn);
  const isGraph = isGraphLikeRecursion(fn, lang);

  if (isGraph) {
    return { class: "graph", reason: "DFS/BFS over graph guarded by visited set → O(V+E)" };
  }

  // Master theorem-ish matching
  if (isHalving) {
    if (a >= 2) {
      // T(n) = a·T(n/2) + f(n)
      if (loopWorkClass === "linear") {
        return { class: "linearithmic", reason: "T(n)=2T(n/2)+O(n) → O(n log n)" };
      }
      if (loopWorkClass === "const") {
        return { class: "linear", reason: "T(n)=2T(n/2)+O(1) → O(n)" };
      }
      if (loopWorkClass === "linearithmic") {
        return { class: "linearithmic", reason: "T(n)=2T(n/2)+O(n log n) ≈ O(n log² n) — reported as O(n log n)" };
      }
      if (loopWorkClass === "log") {
        return { class: "linear", reason: "T(n)=2T(n/2)+O(log n) → O(n)" };
      }
    } else {
      // T(n) = T(n/2) + f(n)
      if (loopWorkClass === "const") {
        return { class: "log", reason: "T(n)=T(n/2)+O(1) → O(log n)" };
      }
      if (loopWorkClass === "linear") {
        return { class: "linear", reason: "T(n)=T(n/2)+O(n) → O(n)" };
      }
      if (loopWorkClass === "log") {
        return { class: "log", reason: "T(n)=T(n/2)+O(log n) → O(log² n) — reported as O(log n)" };
      }
    }
  }
  if (isDecrement) {
    if (a >= 2) {
      // T(n) = 2·T(n-1) + f(n) → exponential
      return { class: "exponential", reason: "T(n)=2T(n-1)+f(n) → O(2ⁿ)" };
    }
    if (loopWorkClass === "const") return { class: "linear", reason: "T(n)=T(n-1)+O(1) → O(n)" };
    if (loopWorkClass === "linear") return { class: "quadratic", reason: "T(n)=T(n-1)+O(n) → O(n²)" };
    if (loopWorkClass === "log") return { class: "linear", reason: "T(n)=T(n-1)+O(log n) → O(n log n) — reported as O(n log n)" };
  }
  // Backtracking-ish: many recursive calls without size shrinkage proof
  if (a >= 2) {
    return { class: "exponential", reason: "multiple recursive calls without size halving — O(branches^depth)" };
  }
  return { class: null, reason: "" };
}

function collectSelfCalls(fn: FuncNode): CallNode[] {
  return fn.calls.filter((c) => c.isSelfCall);
}

function countRecursiveCalls(fn: FuncNode): number {
  // The number of times the function calls itself in any single execution path.
  // Approximation: count distinct self-call sites in straight-line (top-level) and within if/else within body.
  // Without branch analysis, we use total count.
  return fn.calls.filter((c) => c.isSelfCall).length;
}

function anyArgIsHalving(selfCalls: CallNode[], fn: FuncNode): boolean {
  for (const c of selfCalls) {
    const argList = extractArgList(c.raw);
    for (const arg of argList) {
      const a = arg.trim();
      // mid - 1, mid + 1, lo + 1, hi - 1
      if (/(?:^|\s)mid\s*[+-]\s*1\b/.test(a)) return true;
      if (/(?:^|\s)mid\b/.test(a)) return true;
      // n / 2, n // 2, n >> 1, len // 2
      if (/\/\s*2\b/.test(a)) return true;
      if (/\/\/\s*2\b/.test(a)) return true;
      if (/>>\s*1\b/.test(a)) return true;
      // floor((lo+hi)/2)
      if (/\(\s*\w+\s*\+\s*\w+\s*\)\s*\/\/?\s*2/.test(a)) return true;
      // Math.floor((lo+hi)/2)
      if (/Math\.floor\s*\(/.test(a) && /\/\s*2/.test(a)) return true;
      // left half / right half: arr[..mid] / arr[mid+1..]
      if (/\[[^\]]*:\s*\w+\s*\]/.test(a)) return true; // arr[:mid]
      if (/\[\s*\w+\s*[:+]/.test(a)) return true; // arr[mid:]
    }
  }
  return false;
}

function anyArgIsDecrement(selfCalls: CallNode[], fn: FuncNode): boolean {
  for (const c of selfCalls) {
    const argList = extractArgList(c.raw);
    for (const arg of argList) {
      const a = arg.trim();
      // n - 1, n - k literal, i + 1 (typical recursion-on-index)
      if (/-\s*[0-9]+\s*$/.test(a)) return true;
      if (/^\s*([A-Za-z_$][\w$]*)\s*-\s*[0-9]+/.test(a)) return true;
      if (/^\s*([A-Za-z_$][\w$]*)\s*\+\s*1\s*$/.test(a)) return true;
    }
  }
  return false;
}

function extractArgList(raw: string): string[] {
  const open = raw.indexOf("(");
  if (open < 0) return [];
  // find matching close
  let depth = 0;
  let close = -1;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return [];
  const inside = raw.slice(open + 1, close);
  // split on commas at top level
  const out: string[] = [];
  let buf = "";
  let d = 0;
  for (const c of inside) {
    if (c === "(" || c === "[" || c === "{") d++;
    else if (c === ")" || c === "]" || c === "}") d--;
    if (c === "," && d === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

function isGraphLikeRecursion(fn: FuncNode, lang: SupportedLanguage): boolean {
  // Body mentions a `visited`/`seen`/`vis` set guard AND iterates `for ... in adj/graph/neighbors[...]`.
  const body = fn.bodyText;
  const hasVisitedGuard = /\b(?:visited|seen|vis|done)\b/.test(body)
    && (/in\s+(?:visited|seen|vis|done)\b/.test(body)
      || /\.has\s*\(/.test(body)
      || /\.add\s*\(/.test(body));
  const hasNeighborLoop = /\bfor\b[^:{]*\bin\b\s+(?:adj|graph|neighbors|edges|children|next)\b/.test(body)
    || /\bfor\b[^:{]*\bof\b\s+(?:adj|graph|neighbors|edges|children|next)\b/.test(body)
    || /\bfor\b[^:{]*\bin\b\s+\w+\s*\[\s*\w+\s*\]/.test(body); // for v in adj[u]
  return hasVisitedGuard && hasNeighborLoop;
}
