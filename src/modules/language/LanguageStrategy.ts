import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { readFileSync } from "fs";
import type { Problem, SupportedLanguage } from "../interface/Problem";
import { runSandboxed } from "../Sandbox";

function quoteShellPath(p: string): string {
  return p.includes(" ") ? `"${p.replace(/"/g, '\\"')}"` : p;
}

async function execCaptured(
  cmd: string,
  cwd: string,
  timeout: number,
  writePaths?: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await runSandboxed(cmd, { cwd, timeout, writePaths });
  return { stdout, stderr };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
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

const JAVA_MAIN_RE = /\bpublic\s+static\s+void\s+main\s*\(/;
const JAVA_RUNNER_CLASS = "LCexMain";

/** Find the class that declares `public static void main(...)`. Returns null if none. */
function findJavaMainClass(source: string): string | null {
  const idx = source.search(JAVA_MAIN_RE);
  if (idx < 0) return null;
  const before = source.slice(0, idx);
  const matches = [...before.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
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
    return execCaptured(`python3 -B ${quoteShellPath(normalizedPath)}`, workDir, 15000);
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
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lcex-cpp-"));
    const outPath = path.join(
      tmpDir,
      `${path.basename(normalizedPath, ".cpp")}.lcex_run${exeSuffix}`
    );
    try {
      const compile = await execCaptured(
        `g++ -std=c++17 -O2 -Wall -o ${quoteShellPath(outPath)} ${quoteShellPath(normalizedPath)}`,
        tmpDir,
        30000,
        [tmpDir]
      );
      if (!(await fileExists(outPath))) {
        return { stdout: compile.stdout, stderr: compile.stderr || "lcex: g++ produced no binary" };
      }
      return execCaptured(quoteShellPath(outPath), tmpDir, 15000, [tmpDir]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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

const javaStrategy: LanguageStrategy = {
  id: "java",
  fileExtension: ".java",
  leetcodeApiLang: "java",
  shikiLang: "java",
  displayName: "Java",

  getSnippetFromProblem(problem: Problem): string {
    const fromMap = problem.codeSnippets?.java;
    if (fromMap) return fromMap;
    return "";
  },

  isExampleOutputLine(line: string): boolean {
    return /System\.out\.println\s*\(/.test(line);
  },

  parseExampleExpectedComment(line: string): string | null {
    const m = line.match(/\/\/\s*(.+)$/);
    return m ? m[1].trim() : null;
  },

  async runSolutionFile(normalizedPath: string, workDir: string): Promise<{ stdout: string; stderr: string }> {
    const source = await fs.readFile(normalizedPath, "utf8").catch(() => "");
    const entry = findJavaMainClass(source);
    if (!entry) {
      return {
        stdout: "",
        stderr: "lcex: no `public static void main(String[] args)` found in this file",
      };
    }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lcex-java-"));
    try {
      const compile = await execCaptured(
        `javac -d ${quoteShellPath(tmpDir)} ${quoteShellPath(normalizedPath)}`,
        tmpDir,
        30000,
        [tmpDir]
      );
      if (!(await fileExists(path.join(tmpDir, `${entry}.class`)))) {
        return {
          stdout: compile.stdout,
          stderr: compile.stderr || "lcex: javac produced no class file",
        };
      }
      return execCaptured(`java -cp ${quoteShellPath(tmpDir)} ${entry}`, tmpDir, 15000, [tmpDir]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  buildTerminalCommand(filePath: string): string {
    let entry = JAVA_RUNNER_CLASS;
    try {
      const source = readFileSync(filePath, "utf8");
      const found = findJavaMainClass(source);
      if (found) entry = found;
    } catch {
      // fall through with default entry; user will see javac error
    }
    const dir = path.dirname(filePath);
    const outDir = path.join(dir, ".lcex_java_out");
    const qIn = quoteShellPath(filePath);
    const qOut = quoteShellPath(outDir);
    return `mkdir -p ${qOut} && javac -d ${qOut} ${qIn} && java -cp ${qOut} ${entry}`;
  },

  commentPrefix: "//",
  todoPlaceholder: "// TODO",

  getParamCount(snippet: string): number {
    const m = snippet.match(/\b[A-Za-z_$][\w$<>,\s\[\]]*\s+\w+\s*\(([^)]*)\)\s*\{/);
    if (!m) return 1;
    const inner = m[1].trim();
    if (!inner) return 0;
    return inner.split(",").length;
  },

  getFunctionName(snippet: string): string {
    const m = snippet.match(/\b(?:public|private|protected)?\s*(?:static\s+)?[A-Za-z_$][\w$<>,\s\[\]]*\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
    return m ? m[1] : "fn";
  },

  renderExampleCall(fnName: string, argsStr: string, _snippetBody: string): string {
    return `System.out.println(new Solution().${fnName}(${argsStr}));`;
  },

  formatExpectedSuffix(expectedTrimmed: string): string {
    return `  // ${expectedTrimmed}`;
  },

  formatRunnableExampleSection(): string {
    return "";
  },

  usesRunnableTemplateExamples: false,

  appendLocalRunStubIfNeeded(fullSource: string): string {
    if (JAVA_MAIN_RE.test(fullSource)) return "";
    return (
      "\n\n" +
      "// LCex: local entry point for `javac`/`java` (LeetCode uses its own driver on Run/Submit).\n" +
      `class ${JAVA_RUNNER_CLASS} {\n` +
      "    public static void main(String[] args) {\n" +
      "    }\n" +
      "}\n"
    );
  },
};

const STRATEGIES: Record<SupportedLanguage, LanguageStrategy> = {
  typescript: typescriptStrategy,
  javascript: javascriptStrategy,
  python: pythonStrategy,
  cpp: cppStrategy,
  java: javaStrategy,
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
  java: "java",
};

/** LeetCode REST `lang` field per workspace language id. */
export function leetcodeApiLangFor(lang: SupportedLanguage): string {
  return STRATEGIES[lang].leetcodeApiLang;
}
