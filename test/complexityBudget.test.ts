import { describe, it } from "node:test";
import assert from "node:assert";
import { parseProblemConstraints } from "../src/modules/ConstraintParser";
import {
  deriveBudget,
  estimateLoopNesting,
  compareToBudget,
  buildComplexityInlineItems,
} from "../src/modules/ComplexityBudget";

describe("ComplexityBudget", () => {
  it("derives target O(n log n) for n ≤ 10^5", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= nums.length <= 10^5
`);
    const b = deriveBudget(c);
    assert.ok(b);
    assert.strictEqual(b!.maxSize, 100000);
    assert.strictEqual(b!.targetDepth, 1);
    assert.match(b!.targetLabel, /log n/);
  });

  it("derives O(n²) budget for n ≤ 1000", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= n <= 1000
`);
    const b = deriveBudget(c);
    assert.ok(b);
    assert.strictEqual(b!.targetDepth, 2);
  });

  it("allows O(2^n) for tiny n ≤ 20", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= n <= 20
`);
    const b = deriveBudget(c);
    assert.ok(b);
    assert.strictEqual(b!.targetDepth, 99);
  });

  it("estimates nested-loop depth via indentation (python)", () => {
    const src = [
      "class Solution:",
      "    def solve(self, nums):",
      "        for i in range(len(nums)):",
      "            for j in range(i+1, len(nums)):",
      "                if nums[i] == nums[j]:",
      "                    return True",
      "        return False",
    ].join("\n");
    const est = estimateLoopNesting(src, "python");
    assert.strictEqual(est.maxDepth, 2);
    assert.strictEqual(est.loops.length, 2);
  });

  it("estimates depth 3 for triple-nested (typescript)", () => {
    const src = [
      "function solve(nums: number[][]): number {",
      "  for (let i = 0; i < nums.length; i++) {",
      "    for (let j = 0; j < nums.length; j++) {",
      "      for (let k = 0; k < nums.length; k++) {",
      "        if (nums[i][j] === k) return 1;",
      "      }",
      "    }",
      "  }",
      "  return 0;",
      "}",
    ].join("\n");
    const est = estimateLoopNesting(src, "typescript");
    assert.strictEqual(est.maxDepth, 3);
  });

  it("flags over-budget: O(n²) with n ≤ 10^5", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= nums.length <= 10^5
`);
    const b = deriveBudget(c);
    const est = estimateLoopNesting(
      "class Solution:\n    def f(self, nums):\n        for i in nums:\n            for j in nums:\n                pass",
      "python"
    );
    const v = compareToBudget(est, b);
    assert.strictEqual(v.tone, "over");
    assert.strictEqual(v.icon, "🔴");
  });

  it("marks within-budget: O(n) with n ≤ 10^5", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= nums.length <= 10^5
`);
    const b = deriveBudget(c);
    const est = estimateLoopNesting(
      "function f(nums: number[]) { for (let i = 0; i < nums.length; i++) { nums[i]++; } }",
      "typescript"
    );
    const v = compareToBudget(est, b);
    assert.strictEqual(v.tone, "ok");
    assert.strictEqual(v.icon, "🟢");
  });

  it("detects hasSort and upgrades O(n) estimate to O(n log n)", () => {
    const src = [
      "function f(nums: number[]) {",
      "  nums.sort();",
      "  for (const x of nums) { console.log(x); }",
      "}",
    ].join("\n");
    const est = estimateLoopNesting(src, "typescript");
    assert.strictEqual(est.hasSort, true);
  });

  it("builds inline items tagged with correct severities", () => {
    const c = parseProblemConstraints(`
Constraints:
1 <= nums.length <= 10^5
`);
    const b = deriveBudget(c);
    const est = estimateLoopNesting(
      "function f(nums: number[]) {\n  for (let i = 0; i < n; i++) {\n    for (let j = 0; j < n; j++) {\n      nums[i]++;\n    }\n  }\n}",
      "typescript"
    );
    const items = buildComplexityInlineItems(0, est, b);
    assert.strictEqual(items[0].severity, "error", "signature should be error for over-budget");
    const inner = items.find((i) => i.line === 2);
    assert.ok(inner);
    assert.strictEqual(inner!.severity, "error", "depth-2 loop line is error vs target depth 1");
  });

  it("returns null budget when constraints have no size cap", () => {
    const c = parseProblemConstraints(`
Constraints:
Answer fits in a 32-bit integer.
`);
    const b = deriveBudget(c);
    assert.strictEqual(b, null);
  });
});

/**
 * Pattern-catalog tests for the structured analyzer. These guard the cases
 * the indent-only estimator got wrong: constant-bounded inner loops,
 * log-shrinkage loops, two-pointer / sliding-window / monotonic-stack
 * amortized patterns, call-catalog upgrades (heappush, Array.includes), and
 * recursion (Master theorem + DFS-with-visited).
 */
describe("ComplexityEngine — loop bounds", () => {
  it("constant-bounded inner loop (range(26)) → O(n), not O(n²)", () => {
    const src = [
      "class Solution:",
      "    def f(self, s):",
      "        for i in range(len(s)):",
      "            for c in range(26):",
      "                pass",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.maxDepth, 1, `got bigO=${e.bigO}`);
    assert.match(e.bigO, /^O\(n\)$/);
    assert.notStrictEqual(e.confidence, "low");
  });

  it("logarithmic inner loop (x //= 2) inside linear outer → O(n log n)", () => {
    const src = [
      "def f(nums):",
      "    for i in range(len(nums)):",
      "        x = nums[i]",
      "        while x > 0:",
      "            x //= 2",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n log n)");
    assert.strictEqual(e.maxDepth, 1);
    assert.strictEqual(e.hasLogFactor, true);
  });

  it("sqrt loop (i*i <= n) → O(√n)", () => {
    const src = [
      "function f(n: number) {",
      "  for (let i = 1; i * i <= n; i++) {",
      "    if (n % i === 0) return i;",
      "  }",
      "  return -1;",
      "}",
    ].join("\n");
    const e = estimateLoopNesting(src, "typescript");
    assert.match(e.bigO, /√n|sqrt/i);
    assert.strictEqual(e.maxDepth, 0);
  });
});

describe("ComplexityEngine — amortized", () => {
  it("two-pointer while → O(n), not O(n²)", () => {
    const src = [
      "def twoSum(nums, target):",
      "    l, r = 0, len(nums) - 1",
      "    while l < r:",
      "        s = nums[l] + nums[r]",
      "        if s == target: return [l, r]",
      "        if s < target: l += 1",
      "        else: r -= 1",
      "    return []",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n)");
    assert.strictEqual(e.maxDepth, 1);
  });

  it("sliding window (for outer + while-advance inner) → O(n)", () => {
    const src = [
      "def lengthOfLongestSubstring(s):",
      "    seen = {}",
      "    l = 0",
      "    best = 0",
      "    for r in range(len(s)):",
      "        while s[r] in seen and seen[s[r]] >= l:",
      "            l += 1",
      "        seen[s[r]] = r",
      "        if r - l + 1 > best: best = r - l + 1",
      "    return best",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n)", `got ${e.bigO}, reasoning: ${e.reasoning.join("; ")}`);
    assert.strictEqual(e.maxDepth, 1);
  });

  it("monotonic stack (while stack and ...: stack.pop()) inside for → O(n)", () => {
    const src = [
      "def dailyTemperatures(t):",
      "    stack = []",
      "    res = [0] * len(t)",
      "    for i in range(len(t)):",
      "        while stack and t[stack[-1]] < t[i]:",
      "            j = stack.pop()",
      "            res[j] = i - j",
      "        stack.append(i)",
      "    return res",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n)", `got ${e.bigO}`);
    assert.strictEqual(e.maxDepth, 1);
  });
});

describe("ComplexityEngine — call catalog", () => {
  it("heappush in a loop → O(n log n)", () => {
    const src = [
      "import heapq",
      "def f(nums):",
      "    h = []",
      "    for x in nums:",
      "        heapq.heappush(h, x)",
      "    return h",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n log n)", `got ${e.bigO}`);
    assert.strictEqual(e.maxDepth, 1);
    assert.strictEqual(e.hasLogFactor, true);
  });

  it("Array.includes in a loop → O(n²)", () => {
    const src = [
      "function f(nums: number[], q: number[]): number[] {",
      "  const out: number[] = [];",
      "  for (const x of q) {",
      "    if (nums.includes(x)) out.push(x);",
      "  }",
      "  return out;",
      "}",
    ].join("\n");
    const e = estimateLoopNesting(src, "typescript");
    assert.strictEqual(e.bigO, "O(n²)", `got ${e.bigO}`);
    assert.strictEqual(e.maxDepth, 2);
  });

  it("sort + single pass → O(n log n)", () => {
    const src = [
      "function f(nums: number[]) {",
      "  nums.sort();",
      "  for (const x of nums) { console.log(x); }",
      "}",
    ].join("\n");
    const e = estimateLoopNesting(src, "typescript");
    assert.strictEqual(e.bigO, "O(n log n)");
  });
});

describe("ComplexityEngine — recursion", () => {
  it("mergesort 2T(n/2) + O(n) → O(n log n)", () => {
    const src = [
      "def mergeSort(arr):",
      "    if len(arr) <= 1: return arr",
      "    mid = len(arr) // 2",
      "    left = mergeSort(arr[:mid])",
      "    right = mergeSort(arr[mid:])",
      "    out = []",
      "    i, j = 0, 0",
      "    while i < len(left) and j < len(right):",
      "        if left[i] <= right[j]:",
      "            out.append(left[i]); i += 1",
      "        else:",
      "            out.append(right[j]); j += 1",
      "    return out + left[i:] + right[j:]",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n log n)", `got ${e.bigO}; reasoning=${e.reasoning.join(" | ")}`);
  });

  it("linear recursion T(n-1) + O(1) → O(n)", () => {
    const src = [
      "def fact(n):",
      "    if n <= 1: return 1",
      "    return n * fact(n - 1)",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.bigO, "O(n)");
  });

  it("two recursive calls without halving → exponential", () => {
    const src = [
      "def fib(n):",
      "    if n <= 1: return n",
      "    return fib(n - 1) + fib(n - 2)",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.match(e.bigO, /2ⁿ|exp/i);
  });

  it("DFS over adjacency list with visited → O(V+E)", () => {
    const src = [
      "def dfs(u, adj, visited):",
      "    if u in visited: return",
      "    visited.add(u)",
      "    for v in adj[u]:",
      "        dfs(v, adj, visited)",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.match(e.bigO, /V\+E/);
  });
});

describe("ComplexityEngine — confidence", () => {
  it("returns low confidence (severity capped to 🟡) when nested loop bound is unrecognized", () => {
    const src = [
      "def f(g):",
      "    while not g.done():",
      "        while not g.subDone():",
      "            g.step()",
    ].join("\n");
    const e = estimateLoopNesting(src, "python");
    assert.strictEqual(e.confidence, "low");

    const c = parseProblemConstraints(`Constraints:\n1 <= n <= 10^5\n`);
    const b = deriveBudget(c);
    const v = compareToBudget(e, b);
    // Even though depth-2 unknowns mean overall could be O(n²), severity must NOT escalate to 🔴.
    assert.notStrictEqual(v.icon, "🔴", `low-confidence verdicts must not be red, got ${v.icon}`);
  });

  it("empty body → O(1) with high confidence", () => {
    const src = "function f() { return 1; }";
    const e = estimateLoopNesting(src, "typescript");
    assert.strictEqual(e.maxDepth, 0);
    assert.strictEqual(e.confidence, "high");
  });
});

describe("ComplexityEngine — multi-language two-pointer", () => {
  it("two-pointer in TypeScript → O(n)", () => {
    const src = [
      "function twoSum(nums: number[], target: number): number[] {",
      "  let l = 0, r = nums.length - 1;",
      "  while (l < r) {",
      "    const s = nums[l] + nums[r];",
      "    if (s === target) return [l, r];",
      "    if (s < target) l++;",
      "    else r--;",
      "  }",
      "  return [];",
      "}",
    ].join("\n");
    const e = estimateLoopNesting(src, "typescript");
    assert.strictEqual(e.bigO, "O(n)");
  });

  it("two-pointer in C++ → O(n)", () => {
    const src = [
      "vector<int> twoSum(vector<int>& nums, int target) {",
      "  int l = 0, r = nums.size() - 1;",
      "  while (l < r) {",
      "    int s = nums[l] + nums[r];",
      "    if (s == target) return {l, r};",
      "    if (s < target) l++;",
      "    else r--;",
      "  }",
      "  return {};",
      "}",
    ].join("\n");
    const e = estimateLoopNesting(src, "cpp");
    assert.strictEqual(e.bigO, "O(n)");
  });
});
