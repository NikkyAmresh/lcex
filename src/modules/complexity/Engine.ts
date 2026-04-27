import type { SupportedLanguage } from "../interface/Problem";
import { applyAmortizedPatterns } from "./AmortizedPatterns";
import { lookupCallCost } from "./CallCatalog";
import type { Bound, ComplexityResult, FuncNode, Hotspot, LoopNode } from "./IR";
import { classifyLoopBound } from "./LoopBound";
import { analyzeRecursion, type LoopWorkClass } from "./RecursionAnalyzer";
import { tokenize } from "./tokenize";

/**
 * Top-level static complexity analyzer.
 *
 * Pipeline:
 *   1. Tokenize source → IR (functions, loops, calls)
 *   2. Pick the function under analysis (largest non-trivial; the user's solution function)
 *   3. Apply amortized-pattern recognition (mutates LoopNode bounds/tags)
 *   4. Classify each loop's bound (LoopBound module)
 *   5. Walk loop tree: combine nested-loop bounds into a depth/log/sqrt count
 *   6. Inspect calls inside loops: upgrade with CallCatalog (heap ops in a loop, etc.)
 *   7. Run RecursionAnalyzer if the function calls itself
 *   8. Synthesize ComplexityResult with confidence + hotspots + reasoning
 */
export function analyzeComplexity(source: string, lang: SupportedLanguage): ComplexityResult {
  const ir = tokenize(source, lang);
  const fn = pickPrimaryFunction(ir.functions, source);
  if (!fn) {
    return {
      bigO: "O(1) / no loops detected",
      depth: 0,
      hasLogFactor: false,
      confidence: "high",
      hotspots: [],
      reasoning: ["No function body detected — counting as O(1)."],
    };
  }

  // Apply amortized recognition first so bounds are correctly set for those loops.
  applyAmortizedPatterns(fn.loops, lang);

  // Classify any loop that doesn't already have a bound.
  classifyAllBounds(fn, lang);

  // Compute the loop-only complexity for THIS function (ignoring recursion).
  const loopReport = computeLoopComplexity(fn);

  // Recursion (if any) may dominate the loop work.
  const recursion = analyzeRecursion(fn, loopWorkOf(loopReport), lang);

  let resultClass: ComplexityClass = loopReport.class;
  let resultReason: string[] = [...loopReport.reasoning];
  let resultHotspots: Hotspot[] = [...loopReport.hotspots];
  let confidence = loopReport.confidence;

  if (recursion.class) {
    // Recursion overrides
    resultClass = recursionToClass(recursion.class);
    resultReason.push(`Recursion: ${recursion.reason}`);
    resultHotspots.push({
      line: fn.span.startLine,
      label: `recursion: ${recursion.class}`,
      contributesO: classToBigO(resultClass).bigO,
    });
    // Recursion classification is medium confidence at best — pattern-match could be wrong.
    if (confidence === "high") confidence = "medium";
  }

  const big = classToBigO(resultClass);
  return {
    bigO: big.bigO,
    depth: big.depth,
    hasLogFactor: big.hasLogFactor,
    confidence,
    hotspots: resultHotspots,
    reasoning: resultReason,
  };
}

/* ────────────────────────── primary fn picker ────────────────────────── */

function pickPrimaryFunction(funcs: FuncNode[], source: string): FuncNode | null {
  if (funcs.length === 0) return null;
  // Prefer the function whose body is largest. Skip things like `constructor`
  // and obvious helper methods only if there's a clearly dominant function.
  const sorted = [...funcs].sort((a, b) => bodyLen(b) - bodyLen(a));
  return sorted[0];
}

function bodyLen(fn: FuncNode): number {
  return fn.bodyText.length;
}

/* ──────────────────────── classify all bounds ─────────────────────── */

function classifyAllBounds(fn: FuncNode, lang: SupportedLanguage): void {
  const visit = (loop: LoopNode) => {
    if (!loop.bound) {
      loop.bound = classifyLoopBound(loop, fn, lang);
    }
    for (const inner of loop.loops) visit(inner);
  };
  for (const l of fn.loops) visit(l);
}

/* ─────────────────────── loop-tree complexity ─────────────────────── */

type ComplexityClass =
  | "constant"     // O(1)
  | "log"          // O(log n)
  | "sqrt"         // O(sqrt n)
  | "linear"       // O(n)
  | "linearithmic" // O(n log n)
  | "quadratic"    // O(n²)
  | "cubic"        // O(n³)
  | "polyhigh"     // O(n^k>3)
  | "exponential"  // O(2^n)
  | "graph"        // O(V+E)
  | "unknown";

interface LoopReport {
  class: ComplexityClass;
  /** numeric depth used for budget comparisons (n^depth). graph/exp/log map to special depths. */
  depth: number;
  hasLogFactor: boolean;
  confidence: "high" | "medium" | "low";
  hotspots: Hotspot[];
  reasoning: string[];
}

function computeLoopComplexity(fn: FuncNode): LoopReport {
  const hotspots: Hotspot[] = [];
  const reasoning: string[] = [];
  let confidence: "high" | "medium" | "low" = "high";

  // For each top-level loop, compute its own (loop+nested) Big-O class, then
  // OR them together to get the function's overall class (max).
  let overall: ComplexityClass = "constant";
  let overallLog = false;

  for (const loop of fn.loops) {
    const w = walkLoop(loop, "linear", reasoning, hotspots, fn, /* isNested */ false, /* nestDepth */ 1);
    overall = maxClass(overall, w.class);
    overallLog = overallLog || w.hasLog;
    if (w.confidence === "low") confidence = "low";
    else if (w.confidence === "medium" && confidence === "high") confidence = "medium";
  }

  // Calls outside any loop can also upgrade complexity (e.g., a single sort call → O(n log n)).
  for (const call of callsOutsideLoops(fn)) {
    const cost = lookupCallCost(call.name, "typescript"); // lang doesn't matter for call cost dispatch beyond per-lang map
    if (!cost) continue;
    if (cost.kind === "linear") {
      if (compareClass("linear", overall) > 0) {
        overall = "linear";
        hotspots.push({ line: call.line, label: `${call.name} = O(n)`, contributesO: "O(n)" });
        reasoning.push(`Call \`${call.name}\` is O(n).`);
      }
    } else if (cost.kind === "linearithmic") {
      if (compareClass("linearithmic", overall) > 0) {
        overall = "linearithmic";
        hotspots.push({ line: call.line, label: `${call.name} = O(n log n)`, contributesO: "O(n log n)" });
        reasoning.push(`Call \`${call.name}\` is O(n log n).`);
      }
    } else if (cost.kind === "log") {
      if (compareClass("log", overall) > 0) {
        overall = "log";
        hotspots.push({ line: call.line, label: `${call.name} = O(log n)`, contributesO: "O(log n)" });
        reasoning.push(`Call \`${call.name}\` is O(log n).`);
      }
    }
  }

  const depthInfo = classToDepth(overall);
  return {
    class: overall,
    depth: depthInfo.depth,
    hasLogFactor: overallLog || overall === "linearithmic" || overall === "log",
    confidence,
    hotspots,
    reasoning,
  };
}

function callsOutsideLoops(fn: FuncNode): typeof fn.calls {
  const inLoopLines = new Set<number>();
  const collect = (l: LoopNode) => {
    for (let line = l.span.startLine; line <= l.span.endLine; line++) inLoopLines.add(line);
    for (const c of l.loops) collect(c);
  };
  for (const l of fn.loops) collect(l);
  return fn.calls.filter((c) => !inLoopLines.has(c.line));
}

interface LoopWalk {
  class: ComplexityClass;
  hasLog: boolean;
  confidence: "high" | "medium" | "low";
}

function walkLoop(
  loop: LoopNode,
  outerScale: "const" | "log" | "sqrt" | "linear" | "linearithmic" | "quadratic" | "cubic" | "polyhigh" | "unknown",
  reasoning: string[],
  hotspots: Hotspot[],
  fn: FuncNode,
  isNested: boolean,
  nestDepth: number,
): LoopWalk {
  const bound = loop.bound ?? { kind: "unknown" } as Bound;
  let confidence: "high" | "medium" | "low" = "high";

  // amortized: nested → returns "constant" so the OUTER loop does not multiply
  //             (total work absorbed into outer pass).
  //            top-level → returns "linear" — the loop itself iterates O(n) total.
  if (bound.kind === "amortized") {
    confidence = "medium";
    if (isNested) {
      hotspots.push({
        line: loop.span.startLine,
        label: `${loop.kind} (${bound.reason}) — amortized into outer pass`,
        contributesO: "O(1) amortized",
        nestDepth,
        cumulativeClass: outerScale,
      });
      reasoning.push(
        `Loop at line ${loop.span.startLine + 1}: ${bound.reason} — its total iterations across the enclosing pass are O(n), so it does not multiply with the outer loop.`,
      );
      return { class: "constant", hasLog: false, confidence };
    }
    hotspots.push({
      line: loop.span.startLine,
      label: `${loop.kind} (${bound.reason}) ≈ O(n) amortized`,
      contributesO: "O(n)",
      nestDepth,
      cumulativeClass: "linear",
    });
    reasoning.push(
      `Loop at line ${loop.span.startLine + 1}: ${bound.reason} → O(n) total iterations.`,
    );
    return { class: "linear", hasLog: false, confidence };
  }

  if (bound.kind === "const") {
    // doesn't contribute to depth, but still inspect inner loops
    let cls: ComplexityClass = "constant";
    let hasLog = false;
    hotspots.push({
      line: loop.span.startLine,
      label: `${loop.kind} (const k=${(bound as { kind: "const"; k: number }).k}) — does not scale with n`,
      contributesO: "O(1)",
      nestDepth,
      cumulativeClass: outerScale,
    });
    for (const inner of loop.loops) {
      const w = walkLoop(inner, outerScale, reasoning, hotspots, fn, true, nestDepth + 1);
      cls = maxClass(cls, w.class);
      hasLog = hasLog || w.hasLog;
      if (w.confidence === "low") confidence = "low";
    }
    // calls inside this loop, treated as bounded by k * cost
    const callBoost = applyCallBoosts(loop.calls, "constant", reasoning, hotspots);
    cls = maxClass(cls, callBoost);
    return { class: cls, hasLog, confidence };
  }

  if (bound.kind === "unknown") {
    // Worst-case fallback: assume linear, but mark low confidence.
    confidence = "low";
    hotspots.push({
      line: loop.span.startLine,
      label: `${loop.kind} unrecognized — assumed O(n) (low confidence)`,
      contributesO: "O(n)",
      nestDepth,
      cumulativeClass: "linear",
    });
    reasoning.push(`Loop at line ${loop.span.startLine + 1}: could not classify bound — falling back to linear with low confidence.`);
    let cls: ComplexityClass = "linear";
    let hasLog = false;
    for (const inner of loop.loops) {
      const w = walkLoop(inner, "linear", reasoning, hotspots, fn, true, nestDepth + 1);
      cls = multiplyClass("linear", w.class);
      hasLog = hasLog || w.hasLog;
    }
    const callBoost = applyCallBoosts(loop.calls, "linear", reasoning, hotspots);
    cls = maxClass(cls, callBoost);
    return { class: cls, hasLog, confidence };
  }

  // log / sqrt / linear loops
  let myScale: ComplexityClass = "constant";
  if (bound.kind === "log") myScale = "log";
  else if (bound.kind === "sqrt") myScale = "sqrt";
  else if (bound.kind === "linear") myScale = "linear";

  // Cumulative class up to and including this loop level (multiply outer with this loop's bound).
  // outerScale is a string — convert to ComplexityClass.
  const outerCls = (outerScale as ComplexityClass);
  const cumulativeAtThisLevel = isNested ? multiplyClass(outerCls, myScale) : myScale;
  hotspots.push({
    line: loop.span.startLine,
    label: `${loop.kind} ≈ ${classToBigO(myScale).bigO}${isNested ? ` · cumulative ${classToBigO(cumulativeAtThisLevel).bigO}` : ""}`,
    contributesO: classToBigO(cumulativeAtThisLevel).bigO,
    nestDepth,
    cumulativeClass: cumulativeAtThisLevel,
  });

  let cls: ComplexityClass = cumulativeAtThisLevel;
  let hasLog: boolean = myScale === "log" || outerCls === "log";
  for (const inner of loop.loops) {
    const childOuter = (cumulativeAtThisLevel === "constant" ? "linear" : cumulativeAtThisLevel) as
      | "const" | "log" | "sqrt" | "linear" | "linearithmic" | "quadratic" | "cubic" | "polyhigh" | "unknown";
    const w = walkLoop(inner, childOuter, reasoning, hotspots, fn, true, nestDepth + 1);
    cls = maxClass(cls, w.class);
    hasLog = hasLog || w.hasLog;
    if (w.confidence === "low") confidence = "low";
    else if (w.confidence === "medium" && confidence === "high") confidence = "medium";
  }
  // Multiply this loop's body work by its own scale
  const callBoost = applyCallBoosts(loop.calls, "constant", reasoning, hotspots);
  cls = maxClass(cls, multiplyClass(cumulativeAtThisLevel, callBoost));
  return { class: cls, hasLog, confidence };
}

function applyCallBoosts(
  calls: { name: string; line: number; raw: string }[],
  base: ComplexityClass,
  reasoning: string[],
  hotspots: Hotspot[],
): ComplexityClass {
  let cls: ComplexityClass = base;
  for (const c of calls) {
    const cost = lookupCallCost(c.name, "typescript");
    if (!cost) continue;
    let added: ComplexityClass | null = null;
    if (cost.kind === "log") added = "log";
    else if (cost.kind === "linear") added = "linear";
    else if (cost.kind === "linearithmic") added = "linearithmic";
    if (added) {
      const next = maxClass(cls, added);
      if (next !== cls) {
        hotspots.push({
          line: c.line,
          label: `${c.name} adds ${classToBigO(added).bigO}`,
          contributesO: classToBigO(added).bigO,
        });
        reasoning.push(`Call \`${c.name}\` at line ${c.line + 1} contributes ${classToBigO(added).bigO} per invocation.`);
        cls = next;
      }
    }
  }
  return cls;
}

/* ───────────────────── Big-O algebra ───────────────────── */

const CLASS_DEPTH: Record<ComplexityClass, number> = {
  constant: 0,
  log: 0,    // for budget comparisons we treat O(log n) as "fits in any n=10^k budget"
  sqrt: 0,   // ditto — the budget mapping uses depth, and sqrt fits n=10^5
  linear: 1,
  linearithmic: 1, // depth=1 with hasLogFactor
  quadratic: 2,
  cubic: 3,
  polyhigh: 4,
  exponential: 99,
  graph: 1,
  unknown: 1,
};

/** Strict total order over complexity classes for max/compare. Distinguishes
 *  log < sqrt < linear < linearithmic at otherwise-equal depths. */
const CLASS_RANK: Record<ComplexityClass, number> = {
  constant: 0,
  log: 1,
  sqrt: 2,
  linear: 3,
  graph: 3,
  unknown: 3,
  linearithmic: 4,
  quadratic: 5,
  cubic: 6,
  polyhigh: 7,
  exponential: 99,
};

function compareClass(a: ComplexityClass, b: ComplexityClass): number {
  return CLASS_RANK[a] - CLASS_RANK[b];
}

function maxClass(a: ComplexityClass, b: ComplexityClass): ComplexityClass {
  return CLASS_RANK[a] >= CLASS_RANK[b] ? a : b;
}

function multiplyClass(a: ComplexityClass, b: ComplexityClass): ComplexityClass {
  if (a === "constant") return b;
  if (b === "constant") return a;
  if (a === "exponential" || b === "exponential") return "exponential";
  if (a === "polyhigh" || b === "polyhigh") return "polyhigh";
  // log multiplications
  const isLog = (c: ComplexityClass) => c === "log";
  const isLin = (c: ComplexityClass) => c === "linear";
  const isLinarith = (c: ComplexityClass) => c === "linearithmic";
  if (isLin(a) && isLog(b)) return "linearithmic";
  if (isLog(a) && isLin(b)) return "linearithmic";
  if (isLog(a) && isLog(b)) return "log"; // O(log² n) — we report as log for budget purposes
  if (isLin(a) && isLin(b)) return "quadratic";
  if (isLin(a) && isLinarith(b)) return "quadratic"; // n * n log n → quadratic-ish; report as quadratic
  if (isLinarith(a) && isLin(b)) return "quadratic";
  if (isLinarith(a) && isLog(b)) return "linearithmic";
  if (isLog(a) && isLinarith(b)) return "linearithmic";
  if (isLinarith(a) && isLinarith(b)) return "quadratic";
  if (a === "quadratic" && (isLin(b) || isLinarith(b))) return "cubic";
  if (b === "quadratic" && (isLin(a) || isLinarith(a))) return "cubic";
  if (a === "quadratic" && b === "quadratic") return "polyhigh";
  if (a === "cubic" || b === "cubic") return "polyhigh";
  if (a === "sqrt" && isLin(b)) return "linearithmic"; // approximation
  if (a === "sqrt" && a === b) return "linear";
  if (a === "graph" || b === "graph") return "graph"; // graph already = O(V+E), don't multiply
  if (a === "unknown" || b === "unknown") return "unknown";
  return a;
}

function classToBigO(c: ComplexityClass): { bigO: string; depth: number; hasLogFactor: boolean } {
  switch (c) {
    case "constant": return { bigO: "O(1)", depth: 0, hasLogFactor: false };
    case "log": return { bigO: "O(log n)", depth: 0, hasLogFactor: true };
    case "sqrt": return { bigO: "O(√n)", depth: 0, hasLogFactor: false };
    case "linear": return { bigO: "O(n)", depth: 1, hasLogFactor: false };
    case "linearithmic": return { bigO: "O(n log n)", depth: 1, hasLogFactor: true };
    case "quadratic": return { bigO: "O(n²)", depth: 2, hasLogFactor: false };
    case "cubic": return { bigO: "O(n³)", depth: 3, hasLogFactor: false };
    case "polyhigh": return { bigO: "O(n^k)", depth: 4, hasLogFactor: false };
    case "exponential": return { bigO: "O(2ⁿ)", depth: 99, hasLogFactor: false };
    case "graph": return { bigO: "O(V+E)", depth: 1, hasLogFactor: false };
    case "unknown": return { bigO: "O(?)", depth: 1, hasLogFactor: false };
  }
}

function classToDepth(c: ComplexityClass): { depth: number } {
  return { depth: CLASS_DEPTH[c] };
}

function loopWorkOf(report: LoopReport): LoopWorkClass {
  switch (report.class) {
    case "constant": return "const";
    case "log": return "log";
    case "linear": return "linear";
    case "linearithmic": return "linearithmic";
    case "quadratic": return "quadratic";
    case "sqrt": return "log"; // approximation for Master theorem combination
    default: return "unknown";
  }
}

function recursionToClass(r: import("./RecursionAnalyzer").RecursionClass): ComplexityClass {
  switch (r) {
    case "constant": return "constant";
    case "log": return "log";
    case "linear": return "linear";
    case "linearithmic": return "linearithmic";
    case "quadratic": return "quadratic";
    case "exponential": return "exponential";
    case "graph": return "graph";
  }
}
