import { describe, it } from "node:test";
import assert from "node:assert";
import { lintSolutionSource, firstFindingPerLine } from "../src/modules/InterviewLint";

describe("InterviewLint", () => {
  it("flags mutating calls on parameters (python)", () => {
    const src = [
      "class Solution:",
      "    def twoSum(self, nums, target):",
      "        nums.sort()",
      "        return nums",
    ].join("\n");
    const findings = lintSolutionSource(src, "python");
    const mutate = findings.find((f) => f.rule === "mutate-input");
    assert.ok(mutate, "should flag nums.sort()");
    assert.strictEqual(mutate?.line, 2);
    assert.match(mutate?.message ?? "", /nums/);
  });

  it("flags mutating calls on parameters (typescript)", () => {
    const src = [
      "function twoSum(nums: number[], target: number): number[] {",
      "  nums.push(target);",
      "  return nums;",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    const mutate = findings.find((f) => f.rule === "mutate-input");
    assert.ok(mutate, "should flag nums.push()");
    assert.strictEqual(mutate?.severity, "warning");
  });

  it("flags builtin sort even on non-param arrays", () => {
    const src = [
      "function solve(items: number[]): number[] {",
      "  const copy = items.slice();",
      "  copy.sort();",
      "  return copy;",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    const builtin = findings.find((f) => f.rule === "builtin-sort");
    assert.ok(builtin, "should flag copy.sort()");
  });

  it("flags magic numbers but skips const declarations", () => {
    const src = [
      "function solve(s: string): number {",
      "  const ALPHABET = 26;",
      "  const freq = new Array(26).fill(0);",
      "  return 26;",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    const magics = findings.filter((f) => f.rule === "magic-number");
    // Lines: 2 (Array(26).fill), 3 (return 26) — NOT line 1 (const ALPHABET = 26).
    const lines = magics.map((m) => m.line);
    assert.deepStrictEqual(lines.sort(), [2, 3]);
  });

  it("flags indented debug prints without expected comment", () => {
    const src = [
      "class Solution:",
      "    def solve(self, n):",
      "        print('debug', n)",
      "        return n",
      "",
      "print(Solution().solve(5))  # expected: 5",
    ].join("\n");
    const findings = lintSolutionSource(src, "python");
    const debugs = findings.filter((f) => f.rule === "debug-print");
    assert.strictEqual(debugs.length, 1, "only the indented print w/o expected should flag");
    assert.strictEqual(debugs[0].line, 2);
  });

  it("respects // lcex-lint-ignore per-rule suppression", () => {
    const src = [
      "function twoSum(nums: number[], target: number): number[] {",
      "  nums.sort();  // lcex-lint-ignore: mutate-input",
      "  return nums;",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    assert.strictEqual(findings.find((f) => f.rule === "mutate-input"), undefined);
    // builtin-sort is NOT suppressed, should still fire.
    assert.ok(findings.find((f) => f.rule === "builtin-sort"));
  });

  it("respects // lcex-lint-ignore: all", () => {
    const src = [
      "function solve(nums: number[]): number {",
      "  nums.sort();  // lcex-lint-ignore: all",
      "  return 26;",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    const onLine1 = findings.filter((f) => f.line === 1);
    assert.strictEqual(onLine1.length, 0, "all rules suppressed on line 1");
  });

  it("firstFindingPerLine dedupes by line", () => {
    const src = [
      "function solve(nums: number[]): number[] {",
      "  nums.sort();",  // mutate-input + builtin-sort both on this line
      "  return nums;",
      "}",
    ].join("\n");
    const all = lintSolutionSource(src, "typescript");
    assert.ok(all.length >= 2, "expected at least 2 findings on mutating-sort line");
    const dedup = firstFindingPerLine(all);
    const line1 = dedup.filter((f) => f.line === 1);
    assert.strictEqual(line1.length, 1);
  });

  it("ignores code inside string literals", () => {
    const src = [
      "function solve(nums: number[]): string {",
      "  return 'nums.sort()';",
      "}",
    ].join("\n");
    const findings = lintSolutionSource(src, "typescript");
    assert.strictEqual(findings.length, 0, "nothing inside a string literal should trigger");
  });
});
