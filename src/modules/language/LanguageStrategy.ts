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

const DESIGN_CLASS_SKIP = new Set(["Solution", "ListNode", "TreeNode", "Node", "GraphNode"]);

function detectPythonDesignClass(snippet: string): string | null {
  const matches = [...snippet.matchAll(/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm)];
  for (const m of matches) {
    if (!DESIGN_CLASS_SKIP.has(m[1])) return m[1];
  }
  return null;
}

function detectJsLikeDesignClass(snippet: string): string | null {
  const matches = [...snippet.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\b/g)];
  for (const m of matches) {
    if (!DESIGN_CLASS_SKIP.has(m[1])) return m[1];
  }
  return null;
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

export interface DesignExampleInput {
  opsJson: string;
  argsJson: string;
  expected?: string;
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

/**
 * Java entry-class name for a problem file base: `2` → `LCexMain2`, `two-sum` → `LCexMainTwoSum`.
 * Java class names cannot start with a digit or contain `-`, and the file must be named after the
 * class it runs, so Java solution files are named after this entry class.
 */
export function javaEntryClassName(base: string): string {
  const parts = base.split(/[^A-Za-z0-9$]+/).filter(Boolean);
  const pascal = parts.map((p) => (/^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p)).join("");
  return `${JAVA_RUNNER_CLASS}${pascal || "Solution"}`;
}

/** Solution file base for a problem id/slug; Java doubles as the entry class (suffix `-abc` → `_abc`). */
export function solutionFileBaseName(
  lang: SupportedLanguage,
  base: string,
  attemptSuffix = ""
): string {
  if (lang !== "java") return `${base}${attemptSuffix}`;
  return javaEntryClassName(base) + attemptSuffix.replace(/-/g, "_");
}

/** Reverse of Java solution naming: `LCexMain2` → `2`, `LCexMainTwoSum` → `two-sum`; other bases unchanged. */
export function problemKeyFromSolutionFileBase(base: string): string {
  const m = base.match(/^LCexMain(.+?)(_[0-9a-f]{3})?$/i);
  if (!m) return base;
  const inner = m[1];
  if (/^\d+$/.test(inner)) return inner;
  return inner.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

interface JavaMethodSig {
  name: string;
  returnType: string;
  paramTypes: string[];
}

const JAVA_METHOD_RE =
  /\bpublic\s+(?:static\s+)?(?:final\s+)?([A-Za-z_$][\w$.]*(?:\s*<[^(){}]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;

/** Split `int a, List<List<Integer>> b` on commas outside `<>`/`()`/`[]`. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseJavaParamTypes(paramsStr: string): string[] {
  return splitTopLevelCommas(paramsStr).map((p) => p.replace(/\s+[A-Za-z_$][\w$]*$/, "").trim());
}

function parseJavaMethods(snippet: string): Map<string, JavaMethodSig> {
  const out = new Map<string, JavaMethodSig>();
  for (const m of snippet.matchAll(JAVA_METHOD_RE)) {
    if (!out.has(m[2])) {
      out.set(m[2], { returnType: m[1].trim(), name: m[2], paramTypes: parseJavaParamTypes(m[3]) });
    }
  }
  return out;
}

function firstJavaMethod(snippet: string): JavaMethodSig | null {
  for (const sig of parseJavaMethods(snippet).values()) return sig;
  return null;
}

/** JSON example value → Java literal for the declared parameter type; null when not expressible. */
function javaLiteral(value: unknown, declaredType: string): string | null {
  const t = declaredType.replace(/\s+/g, "");
  if (value === null) {
    // Primitives cannot hold null; reference types can.
    return /^(int|long|short|byte|double|float|boolean|char)$/.test(t) ? null : "null";
  }
  if (t.endsWith("[]")) {
    if (!Array.isArray(value)) return null;
    const inner = t.slice(0, -2);
    const elems = value.map((v) => javaLiteral(v, inner));
    if (elems.some((e) => e === null)) return null;
    return `new ${t}{${elems.join(", ")}}`;
  }
  const list = t.match(/^List<(.+)>$/);
  if (list) {
    if (!Array.isArray(value)) return null;
    const elems = value.map((v) => javaLiteral(v, list[1]));
    if (elems.some((e) => e === null)) return null;
    return `Arrays.asList(${elems.join(", ")})`;
  }
  switch (t) {
    case "int":
    case "Integer":
      return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 2147483647
        ? String(value)
        : null;
    case "long":
    case "Long":
      return typeof value === "number" && Number.isInteger(value) ? `${value}L` : null;
    case "double":
    case "Double":
    case "float":
    case "Float": {
      if (typeof value !== "number") return null;
      const lit = Number.isInteger(value) ? `${value}.0` : String(value);
      return t === "float" || t === "Float" ? `${lit}f` : lit;
    }
    case "boolean":
    case "Boolean":
      return typeof value === "boolean" ? String(value) : null;
    case "String":
      return typeof value === "string" ? JSON.stringify(value) : null;
    case "char":
    case "Character": {
      if (typeof value !== "string" || value.length !== 1) return null;
      const c = value === "'" ? "\\'" : value === "\\" ? "\\\\" : value;
      return `'${c}'`;
    }
    default:
      return null; // ListNode, TreeNode, custom types: needs manual setup
  }
}

/** Expression that prints `expr` readably for the given Java return type; null when not printable. */
function wrapJavaPrint(expr: string, declaredType: string): string | null {
  const t = declaredType.replace(/\s+/g, "");
  if (/\[\]\[\]$/.test(t)) return `Arrays.deepToString(${expr})`;
  if (/\[\]$/.test(t)) return `Arrays.toString(${expr})`;
  if (/^List</.test(t)) return expr;
  return /^(int|long|short|byte|double|float|boolean|char|String|Integer|Long|Short|Byte|Double|Float|Boolean|Character)$/.test(
    t
  )
    ? expr
    : null;
}

/** Wraps statements in `class <entry> { public static void main(...) { ... } }`. */
function wrapJavaEntryClass(entryClassName: string, bodyLines: string[]): string {
  const body = bodyLines.map((l) => (l ? `        ${l}` : "")).join("\n");
  return (
    "\n\n" +
    "// LCex: local entry point for `javac`/`java` (LeetCode uses its own driver on Run/Submit).\n" +
    `class ${entryClassName} {\n` +
    "    public static void main(String[] args) {\n" +
    `${body}\n` +
    "    }\n" +
    "}\n"
  );
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
  /** `parsedArgs` are the JSON-parsed example arguments (typed languages need them per-arg). */
  renderExampleCall(fnName: string, argsStr: string, snippetBody: string, parsedArgs?: unknown[]): string;
  formatExpectedSuffix(expectedTrimmed: string): string;
  /** `entryClassName` is the solution file base; Java wraps examples in a class of that name. */
  formatRunnableExampleSection(exampleLines: string[], entryClassName?: string): string;

  /** Detect a class-design problem (e.g. MedianFinder, LRUCache). Returns class name or null. */
  getDesignClassName(snippet: string): string | null;
  /** Generate a runnable section that drives a class-design problem with (ops, args) pairs. */
  renderDesignExampleSection(
    className: string,
    examples: DesignExampleInput[],
    ctx?: { snippet?: string; entryClassName?: string }
  ): string;

  /** Translate a JSON-ish LeetCode expected value (e.g. "true", "null") into the literal the language's stdout print would produce. */
  localizeExpectedLiteral(jsonish: string): string;

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
      if (/^\s*\/\//.test(line)) return false;
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

    localizeExpectedLiteral(jsonish: string): string {
      return jsonish;
    },

    usesRunnableTemplateExamples: true,

    appendLocalRunStubIfNeeded(_fullSource: string): string {
      return "";
    },

    getDesignClassName: detectJsLikeDesignClass,

    renderDesignExampleSection(className: string, examples: DesignExampleInput[]): string {
      if (examples.length === 0) return "";
      const ts = id === "typescript";
      const ctorParam = ts ? "Ctor: any" : "Ctor";
      const opsParam = ts ? "ops: string[]" : "ops";
      const argsParam = ts ? "args: any[][]" : "args";
      const objDecl = ts ? "let obj: any;" : "let obj;";
      const outDecl = ts ? "const out: any[] = [];" : "const out = [];";
      const helper =
        `function _lcexRun(${ctorParam}, ${opsParam}, ${argsParam}) {\n` +
        `  ${objDecl}\n` +
        `  ${outDecl}\n` +
        `  for (let i = 0; i < ops.length; i++) {\n` +
        `    if (i === 0) {\n` +
        `      obj = new Ctor(...args[i]);\n` +
        `      out.push(null);\n` +
        `    } else {\n` +
        `      out.push(obj[ops[i]](...args[i]));\n` +
        `    }\n` +
        `  }\n` +
        `  return out;\n` +
        `}`;
      const calls = examples
        .map(({ opsJson, argsJson, expected }) => {
          const line = `console.log(_lcexRun(${className}, ${opsJson}, ${argsJson}));`;
          return expected ? `${line}  // ${expected}` : line;
        })
        .join("\n");
      return `\n\n${helper}\n\n${calls}\n`;
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
    if (/^\s*#/.test(line)) return false;
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

  localizeExpectedLiteral(jsonish: string): string {
    return jsonish.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");
  },

  usesRunnableTemplateExamples: true,

  appendLocalRunStubIfNeeded(_fullSource: string): string {
    return "";
  },

  getDesignClassName: detectPythonDesignClass,

  renderDesignExampleSection(className: string, examples: DesignExampleInput[]): string {
    if (examples.length === 0) return "";
    const helper =
      `def _lcex_run(cls, ops, args):\n` +
      `    obj = None\n` +
      `    out = []\n` +
      `    for i, op in enumerate(ops):\n` +
      `        if i == 0:\n` +
      `            obj = cls(*args[i])\n` +
      `            out.append(None)\n` +
      `        else:\n` +
      `            out.append(getattr(obj, op)(*args[i]))\n` +
      `    return out`;
    const calls = examples
      .map(({ opsJson, argsJson, expected }) => {
        const line = `print(_lcex_run(${className}, ${opsJson}, ${argsJson}))`;
        return expected ? `${line}  # ${expected}` : line;
      })
      .join("\n");
    return `\n\n${helper}\n\n${calls}\n`;
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
    if (/^\s*\/\//.test(line)) return false;
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

  localizeExpectedLiteral(jsonish: string): string {
    return jsonish.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
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

  getDesignClassName(_snippet: string): string | null {
    return null;
  },

  renderDesignExampleSection(): string {
    return "";
  },
};

/**
 * One design example (ops/args pairs) as direct Java statements:
 * `LRUCache obj1 = new LRUCache(2); obj1.put(1, 1); System.out.println(obj1.get(1));  // 1`.
 * Falls back to a commented description when an op/arg can't be expressed as Java literals.
 */
function renderJavaDesignExample(
  className: string,
  ex: DesignExampleInput,
  n: number,
  methods: Map<string, JavaMethodSig>,
  ctorParamTypes: string[] | null
): string[] {
  const manual = [
    `// LCex: example ${n} needs manual setup:`,
    `// ops:  ${ex.opsJson}`,
    `// args: ${ex.argsJson}`,
    ...(ex.expected ? [`// expected: ${ex.expected}`] : []),
  ];
  let ops: unknown;
  let argLists: unknown;
  try {
    ops = JSON.parse(ex.opsJson);
    argLists = JSON.parse(ex.argsJson);
  } catch {
    return manual;
  }
  if (
    !Array.isArray(ops) ||
    !Array.isArray(argLists) ||
    ops.length === 0 ||
    ops.length !== argLists.length
  ) {
    return manual;
  }
  let expected: unknown;
  try {
    expected = ex.expected ? JSON.parse(ex.expected) : undefined;
  } catch {
    expected = undefined;
  }
  const ctorArgs = argLists[0];
  if (!ctorParamTypes || !Array.isArray(ctorArgs) || ctorArgs.length !== ctorParamTypes.length) {
    return manual;
  }
  const ctorLits = ctorArgs.map((v, i) => javaLiteral(v, ctorParamTypes[i]));
  if (ctorLits.some((l) => l === null)) return manual;
  const obj = `obj${n}`;
  const out: string[] = [`${className} ${obj} = new ${className}(${ctorLits.join(", ")});`];
  for (let k = 1; k < ops.length; k++) {
    const sig = methods.get(String(ops[k]));
    const argsK = argLists[k];
    if (!sig || !Array.isArray(argsK) || argsK.length !== sig.paramTypes.length) return manual;
    const lits = argsK.map((v, j) => javaLiteral(v, sig.paramTypes[j]));
    if (lits.some((l) => l === null)) return manual;
    const call = `${obj}.${sig.name}(${lits.join(", ")})`;
    if (sig.returnType.replace(/\s+/g, "") === "void") {
      out.push(`${call};`);
      continue;
    }
    const printed = wrapJavaPrint(call, sig.returnType);
    if (printed === null) return manual;
    const exp = Array.isArray(expected) ? expected[k] : undefined;
    const suffix =
      exp === undefined || exp === null
        ? ""
        : `  // ${typeof exp === "string" ? exp : JSON.stringify(exp)}`;
    out.push(`System.out.println(${printed});${suffix}`);
  }
  return out;
}

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
    if (/^\s*\/\//.test(line)) return false;
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
    const sig = firstJavaMethod(snippet);
    return sig ? sig.paramTypes.length : 1;
  },

  getFunctionName(snippet: string): string {
    return firstJavaMethod(snippet)?.name ?? "fn";
  },

  renderExampleCall(fnName: string, argsStr: string, snippetBody: string, parsedArgs?: unknown[]): string {
    const fallback = `// LCex: needs manual setup (run on LeetCode instead): ${fnName}(${argsStr})`;
    const sig = parseJavaMethods(snippetBody).get(fnName) ?? firstJavaMethod(snippetBody);
    if (!sig || !parsedArgs || parsedArgs.length !== sig.paramTypes.length) return fallback;
    const lits = parsedArgs.map((v, i) => javaLiteral(v, sig.paramTypes[i]));
    if (lits.some((l) => l === null)) return fallback;
    if (sig.returnType.replace(/\s+/g, "") === "void") {
      // In-place problems: mutate the first array/list argument, then print it.
      const idx = sig.paramTypes.findIndex((pt) => wrapJavaPrint("x", pt) !== null && /\[\]$|^List\s*</.test(pt.replace(/\s+/g, "")));
      if (idx < 0) return fallback;
      const printed = wrapJavaPrint("lcexArg", sig.paramTypes[idx]);
      if (printed === null) return fallback;
      const callArgs = lits.map((l, i) => (i === idx ? "lcexArg" : l)).join(", ");
      return `{ ${sig.paramTypes[idx]} lcexArg = ${lits[idx]}; new Solution().${sig.name}(${callArgs}); System.out.println(${printed}); }`;
    }
    const printed = wrapJavaPrint(`new Solution().${sig.name}(${lits.join(", ")})`, sig.returnType);
    if (printed === null) return fallback;
    return `System.out.println(${printed});`;
  },

  formatExpectedSuffix(expectedTrimmed: string): string {
    return `  // ${expectedTrimmed}`;
  },

  formatRunnableExampleSection(exampleLines: string[], entryClassName?: string): string {
    const lines = exampleLines.length
      ? exampleLines
      : ["// LCex: add example calls here, e.g. System.out.println(new Solution().fn(...));"];
    return wrapJavaEntryClass(entryClassName?.trim() || JAVA_RUNNER_CLASS, lines);
  },

  localizeExpectedLiteral(jsonish: string): string {
    return jsonish;
  },

  usesRunnableTemplateExamples: true,

  mergeHeaderWithSnippet(header: string, snippet: string): string {
    // Templates use `Arrays.*` / `List`, which need java.util locally (LeetCode pre-imports it).
    const importLine = /\bimport\s+java\.util\b/.test(snippet) ? "" : "import java.util.*;\n\n";
    return `${header}\n\n${importLine}${snippet}`;
  },

  appendLocalRunStubIfNeeded(fullSource: string): string {
    if (JAVA_MAIN_RE.test(fullSource)) return "";
    return wrapJavaEntryClass(JAVA_RUNNER_CLASS, []);
  },

  getDesignClassName: detectJsLikeDesignClass,

  renderDesignExampleSection(
    className: string,
    examples: DesignExampleInput[],
    ctx?: { snippet?: string; entryClassName?: string }
  ): string {
    const snippet = ctx?.snippet ?? "";
    const methods = parseJavaMethods(snippet);
    const ctorMatch = snippet.match(new RegExp(`\\bpublic\\s+${className}\\s*\\(([^)]*)\\)`));
    const ctorParamTypes = ctorMatch ? parseJavaParamTypes(ctorMatch[1]) : null;
    const bodyLines: string[] = [];
    examples.forEach((ex, i) => {
      if (i > 0) bodyLines.push("");
      bodyLines.push(...renderJavaDesignExample(className, ex, i + 1, methods, ctorParamTypes));
    });
    if (bodyLines.length === 0) {
      bodyLines.push(`// LCex: drive ${className} here, e.g. ${className} obj = new ${className}(...);`);
    }
    return wrapJavaEntryClass(ctx?.entryClassName?.trim() || JAVA_RUNNER_CLASS, bodyLines);
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
