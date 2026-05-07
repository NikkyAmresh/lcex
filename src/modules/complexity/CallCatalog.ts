import type { SupportedLanguage } from "../interface/Problem";

/**
 * Per-call asymptotic cost in terms of the operand size n.
 *  - "const":     O(1)
 *  - "log":       O(log n) per call (heap ops, bisect, binary search builtins, BST ops)
 *  - "linear":    O(n) per call (scan-the-array operations)
 *  - "linearithmic": O(n log n) per call (sort)
 *  - "linear_total": amortized O(n) when wrapped in n calls, e.g. heappush * n = O(n log n) — handled here as "log"
 *  - "unknown":   bail out
 */
export type CallCost =
  | { kind: "const" }
  | { kind: "log" }
  | { kind: "linear" }
  | { kind: "linearithmic" }
  | { kind: "linear_in"; arg: string };

/**
 * Resolve a call expression to a known cost. The `name` is the parsed
 * (dotted) callee, e.g. "heapq.heappush", "Array.includes",
 * "bisect.bisect_left", "Math.floor".
 *
 * Returns null when unknown.
 */
export function lookupCallCost(name: string, lang: SupportedLanguage): CallCost | null {
  const n = name.toLowerCase();
  // Cross-language
  if (n === "math.floor" || n === "math.ceil" || n === "math.abs" || n === "math.max" || n === "math.min" || n === "math.sqrt" || n === "math.pow" || n === "math.log" || n === "math.log2") {
    return { kind: "const" };
  }
  if (n === "abs" || n === "min" || n === "max" || n === "len") return { kind: "const" };

  // Python heapq
  if (n === "heapq.heappush" || n === "heapq.heappop" || n === "heappush" || n === "heappop"
    || n === "heapq.heappushpop" || n === "heappushpop"
    || n === "heapq.heapreplace" || n === "heapreplace") {
    return { kind: "log" };
  }
  // heapify is O(n)
  if (n === "heapq.heapify" || n === "heapify") return { kind: "linear" };
  // nlargest/nsmallest are O(n log k); approximate as linearithmic for our purposes
  if (n === "heapq.nlargest" || n === "heapq.nsmallest" || n === "nlargest" || n === "nsmallest") {
    return { kind: "linearithmic" };
  }

  // Python bisect
  if (n === "bisect.bisect_left" || n === "bisect.bisect_right" || n === "bisect.bisect"
    || n === "bisect_left" || n === "bisect_right" || n === "bisect") {
    return { kind: "log" };
  }
  // bisect.insort is O(n) because of list insertion
  if (n === "bisect.insort" || n === "bisect.insort_left" || n === "bisect.insort_right"
    || n === "insort" || n === "insort_left" || n === "insort_right") {
    return { kind: "linear" };
  }

  // Sort builtins (linearithmic in their argument)
  if (n === "sorted") return { kind: "linearithmic" };
  if (lang === "python" && n.endsWith(".sort")) return { kind: "linearithmic" };
  if ((lang === "typescript" || lang === "javascript") && n.endsWith(".sort")) return { kind: "linearithmic" };
  if (lang === "cpp" && (n === "std.sort" || n === "sort" || n.endsWith(".sort"))) {
    return { kind: "linearithmic" };
  }
  if (lang === "java" && (n === "Arrays.sort" || n === "Collections.sort" || n.endsWith(".sort"))) {
    return { kind: "linearithmic" };
  }

  // Linear-cost array ops (these are the famous "looks O(n) but is O(n²) when nested" cases)
  if ((lang === "typescript" || lang === "javascript")
    && (n.endsWith(".includes") || n.endsWith(".indexof") || n.endsWith(".lastindexof")
      || n.endsWith(".find") || n.endsWith(".findindex") || n.endsWith(".filter")
      || n.endsWith(".map") || n.endsWith(".foreach") || n.endsWith(".reduce")
      || n.endsWith(".some") || n.endsWith(".every")
      || n.endsWith(".unshift") || n.endsWith(".shift")
      || n.endsWith(".slice") || n.endsWith(".concat") || n.endsWith(".join")
      || n.endsWith(".reverse") || n.endsWith(".flat") || n.endsWith(".flatmap"))) {
    return { kind: "linear" };
  }
  if (lang === "python") {
    if (n === "list.index" || n === "list.count" || n === "list.copy" || n === "list.remove"
      || n.endsWith(".index") || n.endsWith(".count") || n.endsWith(".copy") || n.endsWith(".remove")
      || n === "max" || n === "min" || n === "sum" || n === "any" || n === "all"
      || n === "list" || n === "tuple" || n === "set" || n === "dict") {
      return { kind: "linear" };
    }
    if (n === "reversed" || n === "enumerate" || n === "zip" || n === "map" || n === "filter") {
      // These are O(1) constructors of iterators; the cost is paid by the consumer.
      return { kind: "const" };
    }
    if (n === "range") return { kind: "const" };
  }

  // Set/Dict/Map operations — O(1)
  if (lang === "python") {
    if (n.endsWith(".add") || n.endsWith(".discard") || n.endsWith(".pop")
      || n.endsWith(".popitem") || n.endsWith(".get") || n.endsWith(".setdefault")
      || n.endsWith(".update") || n.endsWith(".keys") || n.endsWith(".values")
      || n.endsWith(".items") || n.endsWith(".clear")
      || n === "defaultdict" || n === "counter" || n === "ordereddict" || n === "deque") {
      return { kind: "const" };
    }
    if (n.endsWith(".append") || n.endsWith(".appendleft") || n.endsWith(".extend")) {
      return { kind: "const" };
    }
  }
  if (lang === "typescript" || lang === "javascript") {
    if (n.endsWith(".set") || n.endsWith(".get") || n.endsWith(".has")
      || n.endsWith(".add") || n.endsWith(".delete") || n.endsWith(".clear")
      || n.endsWith(".size") || n.endsWith(".keys") || n.endsWith(".values")
      || n.endsWith(".entries")) {
      return { kind: "const" };
    }
    if (n.endsWith(".push") || n.endsWith(".pop")) {
      return { kind: "const" };
    }
  }

  // String operations — O(n)
  if (lang === "python") {
    if (n.endsWith(".split") || n.endsWith(".join") || n.endsWith(".replace")
      || n.endsWith(".strip") || n.endsWith(".lower") || n.endsWith(".upper")
      || n.endsWith(".find") || n.endsWith(".rfind") || n.endsWith(".startswith")
      || n.endsWith(".endswith") || n.endsWith(".count")) {
      return { kind: "linear" };
    }
  }
  if (lang === "typescript" || lang === "javascript") {
    if (n.endsWith(".split") || n.endsWith(".replace") || n.endsWith(".replaceall")
      || n.endsWith(".trim") || n.endsWith(".tolowercase") || n.endsWith(".touppercase")
      || n.endsWith(".substring") || n.endsWith(".substr") || n.endsWith(".repeat")
      || n.endsWith(".padstart") || n.endsWith(".padend")) {
      return { kind: "linear" };
    }
  }
  return null;
}
