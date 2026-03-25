import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { Problem, SupportedLanguage } from "../interface/Problem";

const execAsync = promisify(exec);

function quoteShellPath(p: string): string {
  return p.includes(" ") ? `"${p.replace(/"/g, '\\"')}"` : p;
}

async function execCaptured(
  cmd: string,
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout });
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

function isPythonClassBased(snippet: string): boolean {
  return /class\s+Solution\s*:/.test(snippet);
}

function jsLikeParamCount(snippet: string): number {
  const match = snippet.match(/\bfunction\s+\w+\s*\(([^)]*)\)/);
  if (!match) return 1;
  const inner = match[1].trim();
  if (!inner) return 0;
  return inner.split(",").length;
}

function jsLikeFunctionName(snippet: string): string {
  const match = snippet.match(/\bfunction\s+(\w+)\s*\(/);
  return match ? match[1] : "fn";
}

/** Keeps `#include` / `#pragma` / file comments at top; places LCex metadata before `class Solution`. */
function mergeCppHeaderAfterPreamble(header: string, snippet: string): string {
  const m = /\n\s*((?:class|struct)\s+Solution\b)/.exec(snippet);
  if (m && m.index > 0) {
    const preamble = snippet.slice(0, m.index).trimEnd();
    const body = snippet.slice(m.index + 1).trimStart();
    return `${preamble}\n\n${header}\n\n${body}`;
  }
  return `${header}\n\n${snippet}`;
}

/** True if this translation unit already defines global `main` (line-start only; ignores `// int main`). */
function cppSourceDefinesMain(source: string): boolean {
  return /^\s*int\s+main\s*\(/m.test(source);
}

export interface LanguageStrategy {
  readonly id: SupportedLanguage;
  readonly fileExtension: string;
  readonly leetcodeApiLang: string;
  readonly shikiLang: string;
  readonly displayName: string;

  getSnippetFromProblem(problem: Problem): string;

  isExampleOutputLine(line: string): boolean;
  parseExampleExpectedComment(line: string): string | null;

  runSolutionFile(normalizedPath: string, workDir: string): Promise<{ stdout: string; stderr: string }>;

  /** Full shell line for the integrated terminal (compile+run for C++). */
  buildTerminalCommand(filePath: string): string;

  readonly commentPrefix: "#" | "//";
  readonly todoPlaceholder: string;

  getParamCount(snippet: string): number;
  getFunctionName(snippet: string): string;
  renderExampleCall(fnName: string, argsStr: string, snippetBody: string): string;
  formatExpectedSuffix(expectedTrimmed: string): string;
  formatRunnableExampleSection(exampleLines: string[]): string;

  /** When false, templates are snippet + optional local stub only (no console.log / print examples). */
  readonly usesRunnableTemplateExamples: boolean;
  appendLocalRunStubIfNeeded(fullSource: string): string;

  /** Insert problem header after includes / preamble so `#include` stays first (valid C++ / tooling). */
  mergeHeaderWithSnippet?(header: string, snippet: string): string;
}

function createTypeScriptLikeStrategy(
  id: SupportedLanguage,
  fileExtension: string,
  leetcodeApiLang: string,
  shikiLang: string,
  displayName: string,
  runCommand: (quotedPath: string) => string
): LanguageStrategy {
  return {
    id,
    fileExtension,
    leetcodeApiLang,
    shikiLang,
    displayName,

    getSnippetFromProblem(problem: Problem): string {
      const fromMap = problem.codeSnippets?.[leetcodeApiLang] ?? problem.codeSnippets?.[id];
      if (fromMap) return fromMap;
      if (id === "typescript") return problem.codeSnippet;
      return problem.codeSnippet.trim() ? problem.codeSnippet : "";
    },

    isExampleOutputLine(line: string): boolean {
      return /console\.log\s*\(/.test(line);
    },

    parseExampleExpectedComment(line: string): string | null {
      const m = line.match(/\/\/\s*(.+)$/);
      return m ? m[1].trim() : null;
    },

    runSolutionFile(normalizedPath: string, workDir: string): Promise<{ stdout: string; stderr: string }> {
      return execCaptured(runCommand(quoteShellPath(normalizedPath)), workDir, 15000);
    },

    buildTerminalCommand(filePath: string): string {
      return runCommand(quoteShellPath(filePath));
    },

    commentPrefix: "//",
    todoPlaceholder: "// TODO",

    getParamCount: jsLikeParamCount,
    getFunctionName: jsLikeFunctionName,

    renderExampleCall(fnName: string, argsStr: string, _snippetBody: string): string {
      return `console.log(${fnName}(${argsStr}));`;
    },

    formatExpectedSuffix(expectedTrimmed: string): string {
      return `  // ${expectedTrimmed}`;
    },

    formatRunnableExampleSection(exampleLines: string[]): string {
      if (exampleLines.length === 0) return "";
      return "\n\n" + exampleLines.map((line) => `{\n  ${line}\n}`).join("\n\n") + "\n";
    },

    usesRunnableTemplateExamples: true,

    appendLocalRunStubIfNeeded(_fullSource: string): string {
      return "";
    },
  };
}

const typescriptStrategy = createTypeScriptLikeStrategy(
  "typescript",
  ".ts",
  "typescript",
  "typescript",
  "TypeScript",
  (q) => `npx --yes tsx ${q}`
);

const javascriptStrategy = createTypeScriptLikeStrategy(
  "javascript",
  ".js",
  "javascript",
  "javascript",
  "JavaScript",
  (q) => `node ${q}`
);

const pythonStrategy: LanguageStrategy = {
  id: "python",
  fileExtension: ".py",
  leetcodeApiLang: "python3",
  shikiLang: "python",
  displayName: "Python",

  getSnippetFromProblem(problem: Problem): string {
    const fromMap = problem.codeSnippets?.python3 ?? problem.codeSnippets?.python;
    if (fromMap) return fromMap;
    return problem.codeSnippet.trim() ? problem.codeSnippet : "";
  },

  isExampleOutputLine(line: string): boolean {
    return /print\s*\(/.test(line);
  },

  parseExampleExpectedComment(line: string): string | null {
    const m = line.match(/#\s*(.+)$/);
    return m ? m[1].trim() : null;
  },

  runSolutionFile(normalizedPath: string, workDir: string): Promise<{ stdout: string; stderr: string }> {
    return execCaptured(`python3 ${quoteShellPath(normalizedPath)}`, workDir, 15000);
  },

  buildTerminalCommand(filePath: string): string {
    return `python3 ${quoteShellPath(filePath)}`;
  },

  commentPrefix: "#",
  todoPlaceholder: "# TODO",

  getParamCount(snippet: string): number {
    const match = snippet.match(/\bdef\s+\w+\s*\([^)]*\)/);
    if (!match) return 1;
    const inner = snippet.match(/\bdef\s+\w+\s*\(([^)]*)\)/)?.[1] ?? "";
    const params = inner.split(",").map((p) => p.trim()).filter((p) => p && p !== "self");
    return Math.max(1, params.length);
  },

  getFunctionName(snippet: string): string {
    const match = snippet.match(/\bdef\s+(\w+)\s*\(/);
    return match ? match[1] : "fn";
  },

  renderExampleCall(fnName: string, argsStr: string, snippetBody: string): string {
    const call = isPythonClassBased(snippetBody)
      ? `Solution().${fnName}(${argsStr})`
      : `${fnName}(${argsStr})`;
    return `print(${call})`;
  },

  formatExpectedSuffix(expectedTrimmed: string): string {
    return `  # ${expectedTrimmed}`;
  },

  formatRunnableExampleSection(exampleLines: string[]): string {
    if (exampleLines.length === 0) return "";
    return "\n\n" + exampleLines.join("\n") + "\n";
  },

  usesRunnableTemplateExamples: true,

  appendLocalRunStubIfNeeded(_fullSource: string): string {
    return "";
  },
};

const cppStrategy: LanguageStrategy = {
  id: "cpp",
  fileExtension: ".cpp",
  leetcodeApiLang: "cpp",
  shikiLang: "cpp",
  displayName: "C++",

  getSnippetFromProblem(problem: Problem): string {
    const fromMap = problem.codeSnippets?.cpp;
    if (fromMap) return fromMap;
    return "";
  },

  isExampleOutputLine(line: string): boolean {
    return /(?:std::)?cout\s*<</.test(line);
  },

  parseExampleExpectedComment(line: string): string | null {
    const m = line.match(/\/\/\s*(.+)$/);
    return m ? m[1].trim() : null;
  },

  async runSolutionFile(normalizedPath: string, workDir: string): Promise<{ stdout: string; stderr: string }> {
    const exeSuffix = process.platform === "win32" ? ".exe" : "";
    const outPath = path.join(
      workDir,
      `${path.basename(normalizedPath, ".cpp")}.lcex_run${exeSuffix}`
    );
    try {
      await execAsync(`g++ -std=c++17 -O2 -Wall -o "${outPath}" "${normalizedPath}"`, {
        cwd: workDir,
        timeout: 30000,
      });
      return execCaptured(`"${outPath}"`, workDir, 15000);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? String(err),
      };
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  },

  buildTerminalCommand(filePath: string): string {
    const dir = path.dirname(filePath);
    const exeSuffix = process.platform === "win32" ? ".exe" : "";
    const outPath = path.join(dir, `${path.basename(filePath, ".cpp")}.lcex_run${exeSuffix}`);
    const qIn = quoteShellPath(filePath);
    const qOut = quoteShellPath(outPath);
    return `g++ -std=c++17 -O2 -Wall -o ${qOut} ${qIn} && ${qOut}`;
  },

  commentPrefix: "//",
  todoPlaceholder: "// TODO",

  getParamCount: jsLikeParamCount,
  getFunctionName: jsLikeFunctionName,

  renderExampleCall(fnName: string, argsStr: string, _snippetBody: string): string {
    return `std::cout << Solution().${fnName}(${argsStr}) << std::endl;`;
  },

  formatExpectedSuffix(expectedTrimmed: string): string {
    return `  // ${expectedTrimmed}`;
  },

  formatRunnableExampleSection(): string {
    return "";
  },

  usesRunnableTemplateExamples: false,

  mergeHeaderWithSnippet: mergeCppHeaderAfterPreamble,

  appendLocalRunStubIfNeeded(fullSource: string): string {
    if (cppSourceDefinesMain(fullSource)) return "";
    return (
      "\n\n" +
      "// LCex: local `main` for g++/clang++ (LeetCode uses its own driver on Run/Submit).\n" +
      "int main() {\n" +
      "    return 0;\n" +
      "}\n"
    );
  },
};

const STRATEGIES: Record<SupportedLanguage, LanguageStrategy> = {
  typescript: typescriptStrategy,
  javascript: javascriptStrategy,
  python: pythonStrategy,
  cpp: cppStrategy,
};

export function getLanguageStrategy(lang: SupportedLanguage): LanguageStrategy {
  return STRATEGIES[lang];
}

export function languageStrategyFromExtension(ext: string): LanguageStrategy | undefined {
  const e = ext.toLowerCase();
  for (const s of Object.values(STRATEGIES)) {
    if (s.fileExtension.toLowerCase() === e) return s;
  }
  return undefined;
}

export function languageFromFileExtension(ext: string): SupportedLanguage | undefined {
  return languageStrategyFromExtension(ext)?.id;
}

/** Extensions accepted for solution files (e.g. run examples, submit). */
export const SOLUTION_FILE_EXTENSIONS: readonly string[] = Object.values(STRATEGIES).map(
  (s) => s.fileExtension
);

export const LANGUAGE_CHOICES: ReadonlyArray<{ id: SupportedLanguage; label: string }> = (
  Object.values(STRATEGIES) as LanguageStrategy[]
).map((s) => ({ id: s.id, label: s.displayName }));

export const LANGUAGE_SHORT: Record<SupportedLanguage, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  cpp: "cpp",
};

/** LeetCode REST `lang` field per workspace language id. */
export function leetcodeApiLangFor(lang: SupportedLanguage): string {
  return STRATEGIES[lang].leetcodeApiLang;
}
