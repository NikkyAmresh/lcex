import type { Problem, SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

function parseTestInputs(problem: Problem, snippet: string, paramCount: number): string[][] {
  const blocks: string[] = [];
  if (problem.sampleTestCase?.trim()) blocks.push(problem.sampleTestCase.trim());
  for (const ex of problem.exampleTestCases ?? []) {
    const t = String(ex).trim();
    if (t) blocks.push(t);
  }
  const allLines = blocks.flatMap((block) =>
    block.split("\n").map((s) => s.trim()).filter(Boolean)
  );
  const n = Math.max(1, paramCount);
  const result: string[][] = [];
  for (let i = 0; i < allLines.length; i += n) {
    const chunk = allLines.slice(i, i + n);
    if (chunk.length === n) result.push(chunk);
  }
  return result;
}

function renderExampleWithExpected(
  argsLines: string[],
  fnName: string,
  lang: SupportedLanguage,
  snippet: string,
  expectedLine?: string
): string {
  const s = getLanguageStrategy(lang);
  const args = argsLines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return line;
    }
  });
  const argsStr = args.map((a) => JSON.stringify(a)).join(", ");
  const code = s.renderExampleCall(fnName, argsStr, snippet);
  if (expectedLine?.trim()) {
    return `${code}${s.formatExpectedSuffix(expectedLine.trim())}`;
  }
  return code;
}

export function generateTemplate(
  problem: Problem,
  options?: { includeExpected?: boolean; language?: SupportedLanguage }
): string {
  const lang: SupportedLanguage = options?.language ?? "typescript";
  const s = getLanguageStrategy(lang);
  const snippet = s.getSnippetFromProblem(problem).trim() || s.todoPlaceholder;
  const link = `https://leetcode.com/problems/${problem.titleSlug}/`;
  const header = [
    `${s.commentPrefix} ${problem.id}. ${problem.title}`,
    problem.difficulty ? `${s.commentPrefix} Difficulty: ${problem.difficulty}` : null,
    `${s.commentPrefix} ${link}`,
  ]
    .filter(Boolean)
    .join("\n");

  const merged = s.mergeHeaderWithSnippet?.(header, snippet) ?? `${header}\n\n${snippet}`;

  if (!s.usesRunnableTemplateExamples) {
    return `${merged}${s.appendLocalRunStubIfNeeded(merged)}`;
  }

  const fnName = s.getFunctionName(snippet);
  const testInputs = parseTestInputs(problem, snippet, s.getParamCount(snippet));
  const exampleBlocks = testInputs.map((args) =>
    renderExampleWithExpected(args, fnName, lang, snippet, undefined)
  );
  const examplesSection = s.formatRunnableExampleSection(exampleBlocks);
  return `${header}\n\n${snippet}${examplesSection}`;
}
