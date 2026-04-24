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
