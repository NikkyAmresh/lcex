import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildAdversarialSummary,
  findSignatureLine,
} from "../src/modules/AdversarialTests";

const TWO_SUM_HTML = `
<p>Given an array of integers <code>nums</code>...</p>
<p><strong>Constraints:</strong></p>
<ul>
  <li><code>2 &lt;= nums.length &lt;= 10^4</code></li>
  <li><code>-10^9 &lt;= nums[i] &lt;= 10^9</code></li>
  <li><code>-10^9 &lt;= target &lt;= 10^9</code></li>
</ul>
<p><strong>Example 1:</strong></p>
`;

describe("AdversarialTests", () => {
  it("surfaces max-size, boundaries, and negative hints for Two Sum shape", () => {
    const s = buildAdversarialSummary(TWO_SUM_HTML);
    assert.ok(s.perCase.length >= 3, `expected multiple cases, got ${s.perCase.length}`);
    const labels = s.perCase.map((c) => c.label).join(" | ");
    assert.match(labels, /size=/, "should suggest a max-size probe");
    assert.match(labels, /negative|at int bounds/i, "should flag numeric range risks");
    assert.ok(s.signatureLine.startsWith("  ⚠"), "signature line should warn");
  });

  it("renders 10^k sizes with superscript instead of '104'", () => {
    const html = `
<p><strong>Constraints:</strong></p>
<ul>
  <li><code>1 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
</ul>
<p><strong>Example 1:</strong></p>
`;
    const s = buildAdversarialSummary(html);
    const labels = s.perCase.map((c) => c.label).join(" | ");
    assert.match(labels, /10⁴/, `expected superscript form, got labels: ${labels}`);
    assert.doesNotMatch(labels, /size=104\b/, "should not render as '104'");
  });

  it("falls back cleanly when no constraints section exists", () => {
    const s = buildAdversarialSummary("<p>Just a description with no constraints.</p>");
    assert.strictEqual(s.perCase.length, 0);
    assert.match(s.signatureLine, /no structured constraints/i);
  });

  it("finds the def line for Python solutions", () => {
    const src = [
      "from typing import List",
      "",
      "class Solution:",
      "    def twoSum(self, nums: List[int], target: int) -> List[int]:",
      "        return []",
    ].join("\n");
    const line = findSignatureLine(src, "python");
    assert.strictEqual(line, 2, "should land on `class Solution` (line 2)");
  });

  it("finds the function line for TypeScript solutions", () => {
    const src = [
      "// comment",
      "function twoSum(nums: number[], target: number): number[] {",
      "  return [];",
      "}",
    ].join("\n");
    const line = findSignatureLine(src, "typescript");
    assert.strictEqual(line, 1);
  });
});
