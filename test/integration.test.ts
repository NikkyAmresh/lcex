import * as fs from "fs";
import * as path from "path";
import { describe, it } from "node:test";
import assert from "node:assert";
import type { IProblemProvider } from "../src/modules/interface/Problem";
import { LeetCodeProvider } from "../src/modules/LeetCode";
import { InternalApiProvider } from "../src/modules/InternalProvider";
import { generateTemplate } from "../src/modules/TemplateEngine";
import { runTsFile, compareOutput } from "../src/modules/ExampleRunner";

const TEST_OUTPUT_DIR = path.join(__dirname, "..", "test-output");
const PROBLEM_ID = "392";

function getProvider(): IProblemProvider {
  const apiUrl = process.env.LEETCODE_TEST_API_URL?.trim();
  if (apiUrl) return new InternalApiProvider(apiUrl);
  return new LeetCodeProvider();
}

describe("Integration: fetch, scrape, create file, run", () => {
  it("fetches problem 167 from LeetCode, writes real file, runs examples", async () => {
    const provider = getProvider();
    const problem = await provider.getProblem(PROBLEM_ID);

    assert.ok(
      problem,
      "Failed to fetch problem 167. LeetCode often blocks Node; set LEETCODE_TEST_API_URL to your internal API (e.g. GET {url}/problem/167 returns problem JSON) and run again."
    );
    assert.strictEqual(problem.id, PROBLEM_ID, "problem id should be 167");
    assert.ok(problem.title.length > 0, "problem should have title");
    assert.ok(problem.codeSnippet.length > 0, "problem should have code snippet");

    const content = generateTemplate(problem);
    assert.ok(content.includes(`// ${PROBLEM_ID}.`), "template should include problem header");
    assert.ok(content.includes("console.log("), "template should include example blocks");

    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    const filePath = path.join(TEST_OUTPUT_DIR, `${PROBLEM_ID}.ts`);
    fs.writeFileSync(filePath, content, "utf8");

    assert.ok(fs.existsSync(filePath), "file should exist on disk");

    const { stdout, stderr } = await runTsFile(filePath);
    assert.ok(stdout.length > 0 || stderr.length > 0, "run should produce output");

    const results = compareOutput(content, stdout);
    assert.ok(results.length > 0, "should have at least one example result");
    const failed = results.filter((r) => !r.pass);
    assert.strictEqual(
      failed.length,
      0,
      failed.length > 0
        ? `all examples should pass. Failed: ${failed.map((f) => `line ${f.lineIndex}: expected ${f.expected}, got ${f.actual}`).join("; ")}`
        : "all pass"
    );
  });
});
