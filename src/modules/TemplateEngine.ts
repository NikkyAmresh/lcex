import type { Problem, SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

function collectExampleLines(problem: Problem): string[] {
  const blocks: string[] = [];
  const examples = (problem.exampleTestCases ?? [])
    .map((ex) => String(ex).trim())
    .filter(Boolean);
  if (examples.length > 0) {
    blocks.push(...examples);
  } else if (problem.sampleTestCase?.trim()) {
    blocks.push(problem.sampleTestCase.trim());
  }
  return blocks.flatMap((block) =>
    block.split("\n").map((s) => s.trim()).filter(Boolean)
  );
}

function parseTestInputs(problem: Problem, _snippet: string, paramCount: number): string[][] {
  const allLines = collectExampleLines(problem);
  const n = Math.max(1, paramCount);
  const result: string[][] = [];
  for (let i = 0; i < allLines.length; i += n) {
    const chunk = allLines.slice(i, i + n);
    if (chunk.length === n) result.push(chunk);
  }
  return result;
}

function parseDesignExamples(problem: Problem): Array<{ opsJson: string; argsJson: string }> {
  const lines = collectExampleLines(problem);
  const out: Array<{ opsJson: string; argsJson: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    out.push({ opsJson: lines[i], argsJson: lines[i + 1] });
  }
  return out;
}

/** Extract expected outputs (one per example) from the problem HTML content. */
function parseExpectedOutputs(content: string): string[] {
  if (!content) return [];
  const text = content
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  const results: string[] = [];
  // Class-design problems render as "Output\n[null,...]" (no colon); regular
  // problems use "Output: <val>". Accept both, but require a separator so
  // prose like "the Output will be" doesn't match.
  const re = /\bOutput(?:\s*:\s*|\s*\n+\s*)([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let val = m[1].trim();
    if (!val) continue;
    if (val.length >= 2) {
      const first = val[0];
      const last = val[val.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        val = val.slice(1, -1);
      }
    }
    results.push(val);
  }
  return results;
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

  const expectedOutputs = parseExpectedOutputs(problem.content || "");

  const designClass = s.getDesignClassName(snippet);
  if (designClass) {
    const pairs = parseDesignExamples(problem);
    const examples = pairs.map((p, i) => {
      const raw = expectedOutputs[i];
      return {
        opsJson: p.opsJson,
        argsJson: p.argsJson,
        expected: raw ? s.localizeExpectedLiteral(raw) : undefined,
      };
    });
    const section = s.renderDesignExampleSection(designClass, examples);
    return `${header}\n\n${snippet}${section}`;
  }

  const fnName = s.getFunctionName(snippet);
  const testInputs = parseTestInputs(problem, snippet, s.getParamCount(snippet));
  const exampleBlocks = testInputs.map((args, i) => {
    const raw = expectedOutputs[i];
    const expected = raw ? s.localizeExpectedLiteral(raw) : undefined;
    return renderExampleWithExpected(args, fnName, lang, snippet, expected);
  });
  const examplesSection = s.formatRunnableExampleSection(exampleBlocks);
  return `${header}\n\n${snippet}${examplesSection}`;
}
