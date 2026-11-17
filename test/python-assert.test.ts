import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it } from "node:test";
import assert from "node:assert";
import { compareOutput } from "../src/modules/ExampleRunner";
import { ensurePythonAssertHarness } from "../src/modules/language/PythonAssertHarness";
import { getLanguageStrategy } from "../src/modules/language/LanguageStrategy";

const HAS_PYTHON = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const SOLUTION = `class Solution:
    def coinChange(self, coins, amount):
        dp = [0] + [float("inf")] * amount
        for a in range(1, amount + 1):
            for c in coins:
                if c <= a:
                    dp[a] = min(dp[a], dp[a - c] + 1)
        return dp[amount] if dp[amount] != float("inf") else -1

    def helper(self):
        assert True

print("debug")
assert Solution().coinChange([1,2,5], 11) == 3
assert Solution().coinChange([2, 5], 0) == 3
assert Solution().coinChange(None, 1) == 1
assert 0.1 + 0.2 == 0.3
print(Solution().coinChange([2], 4))  # 2
`;

describe("python assert examples", () => {
  it("renders asserts when the expected value is a literal", () => {
    const s = getLanguageStrategy("python");
    const snippet = "class Solution:\n    def f(self, a):\n        pass";
    assert.strictEqual(s.renderAssertExampleCall?.("f", "[1]", snippet, "True"), "assert Solution().f([1]) == True");
    assert.strictEqual(s.renderAssertExampleCall?.("f", "[1]", snippet, "3 Explanation: x"), null);
  });

  it("checks each assert independently", { skip: !HAS_PYTHON }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcex-py-assert-test-"));
    try {
      const file = path.join(dir, "322.py");
      fs.writeFileSync(file, SOLUTION, "utf8");
      const harness = await ensurePythonAssertHarness();
      const stdout = execFileSync("python3", ["-B", harness, file], { stdio: "pipe" }).toString();
      const results = compareOutput(SOLUTION, stdout, "python");
      assert.deepStrictEqual(
        results.map((r) => [r.lineIndex, r.pass, r.actual]),
        [
          [13, true, "debug"],
          [14, true, "3"],
          [15, false, "0"],
          [16, false, "TypeError: 'NoneType' object is not iterable"],
          [17, true, "0.30000000000000004"],
          [18, true, "2"],
        ]
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
