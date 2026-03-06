import type { Problem, SupportedLanguage } from "./interface/Problem";
import { LEETCODE_LANG_SLUG } from "./interface/Problem";

function getSnippetForLang(problem: Problem, lang: SupportedLanguage): string {
  const slug = LEETCODE_LANG_SLUG[lang];
  const fromMap = problem.codeSnippets?.[slug] ?? problem.codeSnippets?.[lang];
  if (fromMap) return fromMap;
  if (lang === "typescript") return problem.codeSnippet;
  return problem.codeSnippet.trim() ? problem.codeSnippet : "";
}

function getParamCount(snippet: string, lang: SupportedLanguage): number {
  if (lang === "python") {
    const match = snippet.match(/\bdef\s+\w+\s*\([^)]*\)/);
    if (!match) return 1;
    const inner = snippet.match(/\bdef\s+\w+\s*\(([^)]*)\)/)?.[1] ?? "";
    const params = inner.split(",").map((p) => p.trim()).filter((p) => p && p !== "self");
    return Math.max(1, params.length);
  }
  const match = snippet.match(/\bfunction\s+\w+\s*\(([^)]*)\)/);
  if (!match) return 1;
  const params = match[1].trim();
  if (!params) return 0;
  return params.split(",").length;
}

function parseTestInputs(problem: Problem, snippet: string, lang: SupportedLanguage): string[][] {
  const blocks: string[] = [];
  if (problem.sampleTestCase?.trim()) blocks.push(problem.sampleTestCase.trim());
  for (const ex of problem.exampleTestCases ?? []) {
    const t = String(ex).trim();
    if (t) blocks.push(t);
  }
  const allLines = blocks.flatMap((block) =>
    block.split("\n").map((s) => s.trim()).filter(Boolean)
  );
  const paramCount = Math.max(1, getParamCount(snippet, lang));
  const result: string[][] = [];
  for (let i = 0; i < allLines.length; i += paramCount) {
    const chunk = allLines.slice(i, i + paramCount);
    if (chunk.length === paramCount) result.push(chunk);
  }
  return result;
}

function getFunctionName(snippet: string, lang: SupportedLanguage): string {
  if (lang === "python") {
    const match = snippet.match(/\bdef\s+(\w+)\s*\(/);
    return match ? match[1] : "fn";
  }
  const match = snippet.match(/\bfunction\s+(\w+)\s*\(/);
  return match ? match[1] : "fn";
}

function isPythonClassBased(snippet: string): boolean {
  return /class\s+Solution\s*:/.test(snippet);
}

function renderExample(
  argsLines: string[],
  fnName: string,
  lang: SupportedLanguage,
  snippet: string
): string {
  const args = argsLines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return line;
    }
  });
  const argsStr = args.map((a) => JSON.stringify(a)).join(", ");
  if (lang === "python") {
    const call = isPythonClassBased(snippet)
      ? `Solution().${fnName}(${argsStr})`
      : `${fnName}(${argsStr})`;
    return `print(${call})`;
  }
  return `console.log(${fnName}(${argsStr}));`;
}

function renderExampleWithExpected(
  argsLines: string[],
  fnName: string,
  lang: SupportedLanguage,
  snippet: string,
  expectedLine?: string
): string {
  const code = renderExample(argsLines, fnName, lang, snippet);
  if (expectedLine?.trim()) return `${code}  # ${expectedLine.trim()}`;
  return code;
}

export function generateTemplate(
  problem: Problem,
  options?: { includeExpected?: boolean; language?: SupportedLanguage }
): string {
  const lang: SupportedLanguage = options?.language ?? "typescript";
  const snippet = getSnippetForLang(problem, lang).trim() || (lang === "python" ? "# TODO" : "// TODO");
  const fnName = getFunctionName(snippet, lang);
  const testInputs = parseTestInputs(problem, snippet, lang);
  const link = `https://leetcode.com/problems/${problem.titleSlug}/`;
  const comment = lang === "python" ? "#" : "//";
  const header = [
    `${comment} ${problem.id}. ${problem.title}`,
    problem.difficulty ? `${comment} Difficulty: ${problem.difficulty}` : null,
    `${comment} ${link}`,
  ]
    .filter(Boolean)
    .join("\n");
  const exampleBlocks = testInputs.map((args) =>
    renderExampleWithExpected(args, fnName, lang, snippet, undefined)
  );
  const examplesSection =
    exampleBlocks.length === 0
      ? ""
      : lang === "python"
        ? "\n\n" + exampleBlocks.join("\n") + "\n"
        : "\n\n" + exampleBlocks.map((line) => `{\n  ${line}\n}`).join("\n\n") + "\n";
  return `${header}\n\n${snippet}${examplesSection}`;
}
