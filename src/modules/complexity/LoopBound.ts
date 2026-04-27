import type { SupportedLanguage } from "../interface/Problem";
import type { Bound, FuncNode, LoopNode } from "./IR";

/**
 * Classify the iteration count of a single loop by inspecting its header
 * (and, for `while` loops, the body — to detect log shrinkage).
 *
 * Conservative: when we can't prove a small bound, we fall back to "linear"
 * (the most common case for unbounded `for ... in n`-style loops) and only
 * declare "unknown" when we genuinely can't tell.
 *
 * `sizeParams` are parameter names that look like a problem-input size
 * (e.g., "nums", "n", "s") — used to recognize `i < nums.length`.
 */
export function classifyLoopBound(
  loop: LoopNode,
  fn: FuncNode,
  lang: SupportedLanguage,
): Bound {
  const header = loop.headerText.trim();

  // 1. Constant: literal upper bound
  const constB = matchConstBound(loop, lang);
  if (constB) return constB;

  // 2. sqrt: i*i <= n style
  const sqrtB = matchSqrtBound(header);
  if (sqrtB) return sqrtB;

  // 3. log: variable shrinks geometrically
  const logB = matchLogBound(loop, lang);
  if (logB) return logB;

  // 4. linear over a size-like variable
  const linB = matchLinearBound(loop, fn, lang);
  if (linB) return linB;

  // 5. while loops without classification → unknown (we can't tell how many iterations)
  if (loop.kind === "while") return { kind: "unknown" };

  // 6. for loops over a collection without size — assume linear in that collection
  // Examples: `for x of nums`, `for nei in adj[u]`, `for c in s`, range-based for in C++.
  if (loop.kind === "for") {
    const sizeName = guessForCollectionSize(loop, lang);
    return { kind: "linear", size: sizeName };
  }
  return { kind: "unknown" };
}

const SIZE_LIKE_NAMES = new Set([
  "n", "m", "k", "q", "len", "size", "length", "nums", "arr", "s", "t", "str",
  "string", "input", "data", "list", "items", "values", "elements", "matrix",
  "grid", "board", "tree", "graph", "adj", "edges", "nodes", "queries",
  "intervals", "points", "stones", "tokens", "words", "names", "tasks",
]);

function isSizeLikeName(name: string): boolean {
  if (!name) return false;
  if (SIZE_LIKE_NAMES.has(name)) return true;
  if (/\.length$/.test(name)) return true;
  if (/\.size\(\)?$/.test(name)) return true;
  if (/^len\(/.test(name)) return true;
  return false;
}

function matchConstBound(loop: LoopNode, lang: SupportedLanguage): Bound | null {
  const header = loop.headerText.trim();
  if (loop.kind === "for") {
    if (lang === "python") {
      // for X in range(LITERAL)
      const m = /^[\w,\s()*]+\s+in\s+range\s*\(\s*([0-9]+)\s*\)/.exec(header);
      if (m) {
        const k = Number(m[1]);
        if (k <= LITERAL_CONST_LIMIT) return { kind: "const", k };
      }
      // for X in range(START, LITERAL[, STEP])
      const m2 = /^[\w,\s()*]+\s+in\s+range\s*\(\s*[^,]+,\s*([0-9]+)\s*(?:,\s*-?[0-9]+)?\s*\)/.exec(header);
      if (m2) {
        const k = Number(m2[1]);
        if (k <= LITERAL_CONST_LIMIT) return { kind: "const", k };
      }
      // for X in [literal_list_with_few_items]
      const lit = /^[\w,\s()*]+\s+in\s*\[([^\]]*)\]/.exec(header);
      if (lit) {
        const items = lit[1].split(",").filter((s) => s.trim().length > 0);
        if (items.length > 0 && items.length <= LITERAL_CONST_LIMIT) {
          return { kind: "const", k: items.length };
        }
      }
      // for X in DIRS / for X in dirs (constant directions tuple is common)
      const namedDirs = /^[\w,\s()*]+\s+in\s+([A-Za-z_][\w]*)\s*$/.exec(header);
      if (namedDirs && /^(dirs?|directions?|moves|deltas?|offsets?)$/i.test(namedDirs[1])) {
        return { kind: "const", k: 8 };
      }
    } else {
      // C-style: for (init; cond; step). Look for `<` / `<=` against a literal.
      const m = /;\s*[A-Za-z_$][\w$]*\s*[<>]=?\s*([0-9]+)\s*;/.exec(header);
      if (m) {
        const k = Number(m[1]);
        if (k <= LITERAL_CONST_LIMIT) return { kind: "const", k };
      }
      // for-of / for-in over short literal array
      const lit = /\bof\s*\[([^\]]*)\]/.exec(header) ?? /\bof\s*\[([^\]]*)\]/.exec(header);
      if (lit) {
        const items = lit[1].split(",").filter((s) => s.trim().length > 0);
        if (items.length > 0 && items.length <= LITERAL_CONST_LIMIT) {
          return { kind: "const", k: items.length };
        }
      }
      // const dirs = [...]; for (const d of dirs) — recognize common dir/direction names
      const namedDirs = /\bof\s+([A-Za-z_$][\w$]*)\s*\)?\s*$/.exec(header);
      if (namedDirs && /^(dirs?|directions?|moves|deltas?|offsets?)$/i.test(namedDirs[1])) {
        return { kind: "const", k: 8 };
      }
    }
  }
  if (loop.kind === "while") {
    // while (i < LITERAL) where the body increments i (NOT decrements toward 0).
    // We only call this constant if the body has an explicit `i += k` / `i++` pattern
    // — otherwise `while x > 0: x //= 2` would be misclassified as O(1).
    const m = /^\s*([A-Za-z_$][\w$]*)\s*<=?\s*([0-9]+)\s*$/.exec(header);
    if (m) {
      const v = m[1];
      const k = Number(m[2]);
      const incRe = new RegExp(`\\b${escapeRe(v)}\\s*(?:\\+\\+|\\+=\\s*[0-9]+)`);
      const decRe = new RegExp(`\\b${escapeRe(v)}\\s*(?:--|-=|//=|>>=|/=)`);
      if (k <= LITERAL_CONST_LIMIT && incRe.test(loop.bodyText) && !decRe.test(loop.bodyText)) {
        return { kind: "const", k };
      }
    }
  }
  return null;
}

const LITERAL_CONST_LIMIT = 256;

function matchSqrtBound(header: string): Bound | null {
  // i*i <= n   or  i*i < n   or  i <= sqrt(n)
  if (/\b([A-Za-z_$][\w$]*)\s*\*\s*\1\s*<=?\s*[A-Za-z_$][\w$]*/.test(header)) {
    const m = /<=?\s*([A-Za-z_$][\w$]*)/.exec(header);
    return { kind: "sqrt", size: m?.[1] };
  }
  if (/\bsqrt\s*\(/.test(header) || /\bMath\.sqrt\s*\(/.test(header)) {
    return { kind: "sqrt" };
  }
  return null;
}

/**
 * A loop is logarithmic if its body shrinks/grows the loop variable by a
 * constant factor each iteration (>>=, <<=, /=, *=, //=, n = n // k, n = n >> k).
 */
function matchLogBound(loop: LoopNode, lang: SupportedLanguage): Bound | null {
  const body = loop.bodyText;
  const header = loop.headerText;
  // Pull the loop variable from a `while X ...` header
  let loopVar: string | null = null;
  const wm = /^\s*([A-Za-z_$][\w$]*)\s*[<>!=]=?\s*/.exec(header);
  if (wm) loopVar = wm[1];
  // Could also be `while X > 0` etc., already covered
  // For for-loops in C-style, the third expr is the step — check it too
  const cstyle = /^([^;]+);([^;]+);([^)]+)$/.exec(header);
  if (cstyle && lang !== "python") {
    const step = cstyle[3].trim();
    if (/[*/]=\s*\d+/.test(step) || /<<=|>>=/.test(step) || /\/\s*=\s*[0-9]+/.test(step)) {
      const init = cstyle[1].trim();
      const m = /([A-Za-z_$][\w$]*)\s*=/.exec(init);
      return { kind: "log", size: m?.[1] };
    }
  }
  if (loopVar) {
    const reShrink = new RegExp(
      `\\b${escapeRe(loopVar)}\\s*(?:>>=|<<=|//=|/=|\\*=|=\\s*${escapeRe(loopVar)}\\s*(?://|>>|<<|\\*|/)\\s*[0-9]+)`,
    );
    if (reShrink.test(body)) {
      return { kind: "log", size: loopVar };
    }
    // Binary-search-ish: lo = mid + 1 / hi = mid - 1
    if (
      /\b(?:lo|low|left|l|start)\s*=\s*mid\s*\+\s*1/.test(body)
      && /\b(?:hi|high|right|r|end)\s*=\s*mid\s*-\s*1/.test(body)
    ) {
      return { kind: "log", size: loopVar };
    }
    // Single-side binary search: only one of lo/hi moves to mid
    if (
      /\bmid\s*=\s*\(?(?:lo|low|left|l|start)\s*\+\s*(?:hi|high|right|r|end)/.test(body)
      || /\bmid\s*=\s*(?:lo|low|left|l|start)\s*\+\s*\(/.test(body)
    ) {
      // mid is computed and one side moves to mid +/- 1 — treat as log
      if (
        /=\s*mid\s*[+-]\s*1/.test(body)
        || /=\s*mid\b/.test(body)
      ) {
        return { kind: "log", size: loopVar };
      }
    }
  }
  return null;
}

function matchLinearBound(loop: LoopNode, fn: FuncNode, lang: SupportedLanguage): Bound | null {
  const header = loop.headerText;
  if (loop.kind === "for") {
    if (lang === "python") {
      // for X in range(SIZE)
      const m = /^[\w,\s()*]+\s+in\s+range\s*\(\s*([^),]+?)\s*\)/.exec(header);
      if (m) {
        const arg = m[1].trim();
        if (isSizeLikeExpr(arg, fn)) return { kind: "linear", size: arg };
      }
      // for X in range(A, B) where B-A is linear
      const m2 = /^[\w,\s()*]+\s+in\s+range\s*\(\s*([^,]+),\s*([^,)]+)\s*(?:,[^)]+)?\)/.exec(header);
      if (m2) {
        const b = m2[2].trim();
        if (isSizeLikeExpr(b, fn)) return { kind: "linear", size: b };
      }
      // for X in COLLECTION
      const m3 = /^[\w,\s()*]+\s+in\s+([A-Za-z_][\w.\[\]]*)\s*$/.exec(header);
      if (m3) {
        const name = m3[1];
        return { kind: "linear", size: name };
      }
    } else {
      // for (let i=0; i<n; i++) — read RHS of the comparison
      const m = /;\s*[A-Za-z_$][\w$]*\s*[<>]=?\s*([^;]+);/.exec(header);
      if (m) {
        const rhs = m[1].trim();
        if (isSizeLikeExpr(rhs, fn)) return { kind: "linear", size: rhs };
        return { kind: "linear", size: rhs };
      }
      // for (const x of nums) — linear in nums
      const ofM = /\b(?:of|in)\s+([A-Za-z_$][\w$.\[\]]*)/.exec(header);
      if (ofM) return { kind: "linear", size: ofM[1] };
    }
  }
  return null;
}

function guessForCollectionSize(loop: LoopNode, lang: SupportedLanguage): string | undefined {
  const header = loop.headerText;
  if (lang === "python") {
    const m = /\sin\s+([A-Za-z_][\w.\[\]]*)/.exec(header);
    return m?.[1];
  }
  const m = /\b(?:of|in)\s+([A-Za-z_$][\w$.\[\]]*)/.exec(header);
  return m?.[1];
}

function isSizeLikeExpr(expr: string, fn: FuncNode): boolean {
  const e = expr.trim();
  // Pure size-like name, parameter, or len(param) / param.length / param.size()
  const m = /^([A-Za-z_$][\w$.()]*)$/.exec(e);
  if (!m) return false;
  if (isSizeLikeName(e)) return true;
  // Parameters of the function
  for (const p of fn.params) {
    if (e === p) return true;
    if (e === `${p}.length`) return true;
    if (e === `${p}.size()`) return true;
    if (e === `len(${p})`) return true;
    if (e === `${p}.size`) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
