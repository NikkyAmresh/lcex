import type { SupportedLanguage } from "./interface/Problem";

/**
 * Canonical interview-pattern catalogue. Each pattern is detected from the
 * solution source by signature regex over a normalized form (comments and
 * string literals stripped). The list mirrors the patterns surveyed in
 * popular interview prep guides (Grokking the Coding Interview, NeetCode 75,
 * Striver's SDE sheet) so that the mastery dashboard maps onto familiar
 * mental models.
 */
export type PatternId =
  | "twoPointers"
  | "slidingWindow"
  | "binarySearch"
  | "bfs"
  | "dfsRecursive"
  | "dfsIterative"
  | "dpTopDown"
  | "dpBottomUp"
  | "backtracking"
  | "greedy"
  | "heap"
  | "trie"
  | "unionFind"
  | "topoSort"
  | "monotonicStack"
  | "bitManipulation"
  | "hashMapSet"
  | "linkedList"
  | "prefixSum"
  | "treeTraversal";

export interface PatternMeta {
  id: PatternId;
  label: string;
  /** Short description shown in the mastery dashboard hover. */
  blurb: string;
  /** Emoji icon (rendered alongside label in tree view). */
  icon: string;
  /** A short LeetCode tag the pattern correlates to (used for "next problem"). */
  leetcodeTag?: string;
}

export const PATTERNS: readonly PatternMeta[] = [
  { id: "twoPointers", label: "Two Pointers", blurb: "Walking two indices through an array", icon: "↔", leetcodeTag: "two-pointers" },
  { id: "slidingWindow", label: "Sliding Window", blurb: "Maintaining a window over a contiguous range", icon: "⊟", leetcodeTag: "sliding-window" },
  { id: "binarySearch", label: "Binary Search", blurb: "Halving search space", icon: "⇩", leetcodeTag: "binary-search" },
  { id: "bfs", label: "BFS", blurb: "Level-order graph or grid traversal", icon: "≡", leetcodeTag: "breadth-first-search" },
  { id: "dfsRecursive", label: "DFS (Recursive)", blurb: "Recursive depth-first traversal", icon: "↳", leetcodeTag: "depth-first-search" },
  { id: "dfsIterative", label: "DFS (Iterative)", blurb: "Stack-based depth-first traversal", icon: "▤", leetcodeTag: "depth-first-search" },
  { id: "dpTopDown", label: "DP (Top-Down / Memo)", blurb: "Recursion + memoization", icon: "⟲", leetcodeTag: "dynamic-programming" },
  { id: "dpBottomUp", label: "DP (Bottom-Up)", blurb: "Tabular dynamic programming", icon: "⊞", leetcodeTag: "dynamic-programming" },
  { id: "backtracking", label: "Backtracking", blurb: "Try / undo / try again", icon: "↺", leetcodeTag: "backtracking" },
  { id: "greedy", label: "Greedy", blurb: "Sort then linear scan with locally-best choice", icon: "▶", leetcodeTag: "greedy" },
  { id: "heap", label: "Heap / Priority Queue", blurb: "Min/Max heap selection", icon: "▲", leetcodeTag: "heap-priority-queue" },
  { id: "trie", label: "Trie", blurb: "Prefix tree of characters", icon: "Y", leetcodeTag: "trie" },
  { id: "unionFind", label: "Union-Find", blurb: "Disjoint-set merges", icon: "⨯", leetcodeTag: "union-find" },
  { id: "topoSort", label: "Topological Sort", blurb: "Kahn / DFS topological ordering", icon: "→", leetcodeTag: "topological-sort" },
  { id: "monotonicStack", label: "Monotonic Stack", blurb: "Stack maintaining sorted invariant", icon: "▧", leetcodeTag: "monotonic-stack" },
  { id: "bitManipulation", label: "Bit Manipulation", blurb: "XOR / AND / shift tricks", icon: "⊕", leetcodeTag: "bit-manipulation" },
  { id: "hashMapSet", label: "Hash Map / Set", blurb: "Constant-time lookup table", icon: "#", leetcodeTag: "hash-table" },
  { id: "linkedList", label: "Linked List", blurb: "node.next traversal / pointer surgery", icon: "⇄", leetcodeTag: "linked-list" },
  { id: "prefixSum", label: "Prefix Sum", blurb: "Running totals over an array", icon: "Σ", leetcodeTag: "prefix-sum" },
  { id: "treeTraversal", label: "Tree Traversal", blurb: "Walking root.left / root.right", icon: "⨹", leetcodeTag: "tree" },
] as const;

const PATTERNS_BY_ID: Record<PatternId, PatternMeta> = (() => {
  const out = {} as Record<PatternId, PatternMeta>;
  for (const p of PATTERNS) out[p.id] = p;
  return out;
})();

export function getPatternMeta(id: PatternId): PatternMeta {
  return PATTERNS_BY_ID[id];
}

/**
 * Strip comments and string literals from source so that signatures don't
 * hit on `// uses two pointers` or a docstring. Best-effort and language-aware.
 */
function stripCommentsAndStrings(source: string, lang: SupportedLanguage): string {
  let out = source;
  if (lang === "python") {
    out = out.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, "");
    out = out.replace(/#[^\n]*/g, "");
    out = out.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  } else {
    // ts / js / cpp share C-style comments and double/single/template strings
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    out = out.replace(/\/\/[^\n]*/g, "");
    out = out.replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '""');
    out = out.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  }
  return out;
}

interface SignatureRule {
  id: PatternId;
  /**
   * Confidence weight added when the regex matches. Multiple regexes summing
   * above THRESHOLD register the pattern. Calibrated so a single strong
   * keyword (e.g. `union(`, `Trie`, `heappush`) is enough, while weaker
   * heuristics (sort+loop) need corroboration.
   */
  weight: number;
  match: RegExp;
}

const THRESHOLD = 2;

const RULES: readonly SignatureRule[] = [
  // Two Pointers
  { id: "twoPointers", weight: 2, match: /\bwhile\s*\(\s*(left|l|i|lo)\s*<\s*(right|r|j|hi)\s*\)/ },
  { id: "twoPointers", weight: 1, match: /\b(left|l|lo)\s*\+\+|\b(right|r|hi)\s*--/ },
  { id: "twoPointers", weight: 1, match: /\b(left|l|lo)\s*=\s*0[\s\S]{0,80}?\b(right|r|hi)\s*=\s*[a-zA-Z_$][\w$]*\.length\b/ },

  // Sliding Window
  { id: "slidingWindow", weight: 2, match: /\bwhile\s*\([^)]*?\)\s*\{[^}]*?\b(left|l|start)\b\s*\+\+/ },
  { id: "slidingWindow", weight: 1, match: /\b(window|windowSum|windowCount|windowMap)\b/ },
  { id: "slidingWindow", weight: 1, match: /\bfor\s*\(\s*(let|const|int|var)?\s*(right|r|end|j)\s*=\s*0/ },

  // Binary Search
  { id: "binarySearch", weight: 2, match: /\bmid\s*=\s*[^;]*\(\s*(left|l|lo)\s*\+\s*(right|r|hi)\s*\)\s*[/>]/ },
  { id: "binarySearch", weight: 2, match: /\b(left|l|lo)\s*=\s*mid\s*\+\s*1|\b(right|r|hi)\s*=\s*mid\s*-\s*1/ },
  { id: "binarySearch", weight: 1, match: /\bbisect_(left|right|insort)\b|\bMath\.floor\(\(/ },

  // BFS
  { id: "bfs", weight: 2, match: /\bwhile\s*\(\s*(queue|q|deque)\b[\s\S]{0,30}\b(length|size|empty)\b/ },
  { id: "bfs", weight: 1, match: /\b(queue|q|deque)\.(push|append|appendleft|enqueue)\(/ },
  { id: "bfs", weight: 1, match: /\b(queue|q)\.(shift|popleft|dequeue)\(/ },

  // DFS Iterative
  { id: "dfsIterative", weight: 2, match: /\bwhile\s*\(\s*(stack|st)\b[\s\S]{0,30}\b(length|size|empty)\b/ },
  { id: "dfsIterative", weight: 1, match: /\b(stack|st)\.push\([^)]*\)/ },
  { id: "dfsIterative", weight: 1, match: /\b(stack|st)\.pop\(\)/ },

  // DFS Recursive (function recurses, not stack-based)
  { id: "dfsRecursive", weight: 2, match: /\bfunction\s+(\w+)[\s\S]*?\b\1\s*\(/ },
  { id: "dfsRecursive", weight: 2, match: /\b(const|let|var)\s+(dfs|recurse|helper|solve|backtrack)\b/ },
  { id: "dfsRecursive", weight: 1, match: /\bdef\s+(dfs|recurse|helper|solve|backtrack)\b/ },

  // DP Top-Down (memoization)
  { id: "dpTopDown", weight: 2, match: /\b(memo|cache|seen)\b\s*[=:].*new\s+(Map|Object)|\b(memo|cache)\s*=\s*\{\}/ },
  { id: "dpTopDown", weight: 2, match: /\b(@cache|@lru_cache|@functools\.cache)/ },
  { id: "dpTopDown", weight: 1, match: /\b(memo|cache)\.(get|set|has)\(/ },

  // DP Bottom-Up
  { id: "dpBottomUp", weight: 2, match: /\bdp\s*\[\s*(\w+)\s*\]\s*=/ },
  { id: "dpBottomUp", weight: 2, match: /\bdp\s*=\s*(new\s+)?Array\(|dp\s*=\s*\[0\]\s*\*/ },
  { id: "dpBottomUp", weight: 1, match: /\bdp\[i\]\[j\]\s*=/ },

  // Backtracking
  { id: "backtracking", weight: 2, match: /\.push\([^)]*\);?\s*\n[^\n]*\b(dfs|backtrack|recurse|helper|solve)\s*\([\s\S]{0,200}?\.pop\(\)/ },
  { id: "backtracking", weight: 1, match: /\bbacktrack\s*\(|\bdef\s+backtrack/ },

  // Heap / Priority Queue
  { id: "heap", weight: 3, match: /\bheapq\.heappush\b|\bheapq\.heappop\b|\bheappushpop\b/ },
  { id: "heap", weight: 3, match: /\b(MinHeap|MaxHeap|PriorityQueue|MinPQ|MaxPQ)\b/ },

  // Trie
  { id: "trie", weight: 3, match: /\bclass\s+Trie(Node)?\b|\bTrieNode\b/ },
  { id: "trie", weight: 2, match: /\bchildren\s*[=:]\s*(new\s+Map|\{\}|\[\])[\s\S]{0,80}\bisEnd|\bisEnd(Of)?Word\b/ },

  // Union-Find
  { id: "unionFind", weight: 3, match: /\bclass\s+(UnionFind|DisjointSet|DSU)\b/ },
  { id: "unionFind", weight: 2, match: /\bfind\s*\(\s*\w+\s*\)[\s\S]{0,80}?\bunion\s*\(\s*\w+\s*,\s*\w+\s*\)/ },
  { id: "unionFind", weight: 1, match: /\bparent\[\w+\]\s*=\s*find\(/ },

  // Topological Sort
  { id: "topoSort", weight: 2, match: /\b(inDegree|indegree|in_degree)\b/ },
  { id: "topoSort", weight: 1, match: /\bkahn|topologicalSort|topo_sort\b/ },

  // Monotonic Stack
  { id: "monotonicStack", weight: 3, match: /\bwhile\s*\(\s*(stack|st)\.length\s*&&[\s\S]{0,80}?\.pop\(\)/ },
  { id: "monotonicStack", weight: 2, match: /\bwhile\s+(stack|st)\s+and[\s\S]{0,80}?\.pop\(\)/ },

  // Bit Manipulation (require multiple operators in close proximity)
  { id: "bitManipulation", weight: 2, match: /\^\s*\w+[\s\S]{0,40}?(\&|\||<<|>>)/ },
  { id: "bitManipulation", weight: 2, match: /\(\s*1\s*<<\s*\w+\s*\)/ },
  { id: "bitManipulation", weight: 1, match: /\b__builtin_popcount\b|\bpopcount\b|\bbit_count\b/ },

  // Hash Map / Set
  { id: "hashMapSet", weight: 1, match: /\bnew\s+(Map|Set)\(/ },
  { id: "hashMapSet", weight: 1, match: /\bdefaultdict\b|\bCounter\(/ },
  { id: "hashMapSet", weight: 1, match: /\bunordered_(map|set)<|\bstd::(map|set)</ },

  // Linked List
  { id: "linkedList", weight: 2, match: /\b(\w+)\.next\s*=\s*(\w+)(\.next)?\b/ },
  { id: "linkedList", weight: 2, match: /\bdummy\b[\s\S]{0,40}\.next/ },
  { id: "linkedList", weight: 1, match: /\b(slow|fast|prev|curr|head|tail)\.next\b/ },
  { id: "linkedList", weight: 1, match: /\bListNode\b/ },

  // Prefix Sum
  { id: "prefixSum", weight: 3, match: /\bprefix\[\s*\w+\s*\]\s*=\s*prefix\[\s*\w+\s*-\s*1\s*\]\s*\+/ },
  { id: "prefixSum", weight: 1, match: /\b(prefixSum|prefix_sum|cumSum|cumulative)\b/ },

  // Tree Traversal
  { id: "treeTraversal", weight: 2, match: /\broot\.(left|right)\b/ },
  { id: "treeTraversal", weight: 1, match: /\b(node|root)\.left[\s\S]{0,80}?(node|root)\.right/ },
];

export interface PatternDetectionResult {
  /** Patterns whose total weight ≥ THRESHOLD. */
  matched: PatternId[];
  /** Per-pattern weight totals (for debug / future weighting). */
  scores: Partial<Record<PatternId, number>>;
}

export function detectPatterns(source: string, lang: SupportedLanguage): PatternDetectionResult {
  if (!source || source.length < 20) return { matched: [], scores: {} };
  const stripped = stripCommentsAndStrings(source, lang);
  const scores: Partial<Record<PatternId, number>> = {};
  for (const rule of RULES) {
    if (rule.match.test(stripped)) {
      scores[rule.id] = (scores[rule.id] ?? 0) + rule.weight;
    }
  }
  const matched: PatternId[] = [];
  for (const [id, sc] of Object.entries(scores) as [PatternId, number][]) {
    if (sc >= THRESHOLD) matched.push(id);
  }
  // Drop overlapping shadows: if dpTopDown matched, drop bare dfsRecursive.
  if (matched.includes("dpTopDown")) {
    const i = matched.indexOf("dfsRecursive");
    if (i >= 0) matched.splice(i, 1);
  }
  return { matched, scores };
}
