import { describe, it } from "node:test";
import assert from "node:assert";
import { parseProblemConstraints } from "../src/modules/ConstraintParser";

describe("ConstraintParser", () => {
  it("parses numeric bounds including 10^k notation", () => {
    const text = `
Given an array of integers.

Constraints:
1 <= nums.length <= 10^5
-10^9 <= nums[i] <= 10^9
0 <= k <= 100
`;
    const c = parseProblemConstraints(text);
    assert.strictEqual(c.byName.get("nums.length")?.min, 1);
    assert.strictEqual(c.byName.get("nums.length")?.max, 100000);
    assert.strictEqual(c.byName.get("nums[i]")?.min, -1_000_000_000);
    assert.strictEqual(c.byName.get("nums[i]")?.max, 1_000_000_000);
    assert.strictEqual(c.byName.get("k")?.max, 100);
  });

  it("parses HTML-wrapped constraints with &le; and &lt;= entities", () => {
    const html = `
<p>Blah.</p>
<p><strong>Constraints:</strong></p>
<ul>
  <li><code>1 &lt;= s.length &lt;= 10^5</code></li>
  <li><code>s</code> consists of only lowercase English letters.</li>
</ul>
<p><strong>Example 1:</strong></p>
`;
    const c = parseProblemConstraints(html);
    const s = c.byName.get("s.length");
    assert.strictEqual(s?.min, 1);
    assert.strictEqual(s?.max, 100000);
    assert.strictEqual(c.byName.get("s")?.charset, "lowercase");
  });

  it("detects sorted / distinct flags", () => {
    const text = `
Constraints:
1 <= nums.length <= 50
nums is sorted in non-decreasing order.
All the integers of nums are unique.
`;
    const c = parseProblemConstraints(text);
    assert.strictEqual(c.byName.get("nums")?.sorted, "asc");
    assert.strictEqual(c.byName.get("nums")?.distinct, true);
  });

  it("handles LeetCode's <sup>N</sup> exponent markup", () => {
    const html = `
<p>Blah.</p>
<p><strong>Constraints:</strong></p>
<ul>
  <li><code>1 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
  <li><code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code></li>
</ul>
<p><strong>Example 1:</strong></p>
`;
    const c = parseProblemConstraints(html);
    assert.strictEqual(c.byName.get("nums.length")?.max, 10000);
    assert.strictEqual(c.byName.get("nums[i]")?.min, -1_000_000_000);
    assert.strictEqual(c.byName.get("nums[i]")?.max, 1_000_000_000);
  });

  it("stops at Example / Follow-up section", () => {
    const text = `
Constraints:
1 <= n <= 10
Follow-up: can you solve in O(1) space?
2 <= m <= 20
`;
    const c = parseProblemConstraints(text);
    assert.strictEqual(c.byName.has("n"), true);
    assert.strictEqual(c.byName.has("m"), false);
  });
});
