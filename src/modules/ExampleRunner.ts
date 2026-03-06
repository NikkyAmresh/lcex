import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type SolutionFileLang = "typescript" | "javascript" | "python";

export interface ExampleResult {
  lineIndex: number;
  pass: boolean;
  expected: string | null;
  actual: string;
}

function langFromExt(ext: string): SolutionFileLang {
  if (ext === ".py") return "python";
  if (ext === ".js") return "javascript";
  return "typescript";
}

export function parseExampleBlocks(
  content: string,
  lang: SolutionFileLang = "typescript"
): { callLine: number; expected: string | null }[] {
  const results: { callLine: number; expected: string | null }[] = [];
  const lines = content.split("\n");
  const isOutputLine =
    lang === "python"
      ? (line: string) => /print\s*\(/.test(line)
      : (line: string) => /console\.log\s*\(/.test(line);
  const commentRegex = lang === "python" ? /#\s*(.+)$/ : /\/\/\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isOutputLine(line)) continue;
    const commentMatch = line.match(commentRegex);
    results.push({ callLine: i + 1, expected: commentMatch ? commentMatch[1].trim() : null });
  }
  return results;
}

export async function runSolutionFile(
  filePath: string,
  lang?: SolutionFileLang
): Promise<{ stdout: string; stderr: string }> {
  const ext = path.extname(filePath);
  const resolvedLang = lang ?? langFromExt(ext);
  const dir = path.dirname(filePath);
  const normalized = path.normalize(filePath);
  const cmd =
    resolvedLang === "python"
      ? `python3 "${normalized}"`
      : resolvedLang === "javascript"
        ? `node "${normalized}"`
        : `npx --yes tsx "${normalized}"`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: dir,
      timeout: 15000,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

/** @deprecated Use runSolutionFile */
export async function runTsFile(filePath: string): Promise<{ stdout: string; stderr: string }> {
  return runSolutionFile(filePath, "typescript");
}

function parseStdoutLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeExpected(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function normalizeActual(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function compareOutput(
  content: string,
  stdout: string,
  lang: SolutionFileLang = "typescript"
): ExampleResult[] {
  const blocks = parseExampleBlocks(content, lang);
  const actualLines = parseStdoutLines(stdout);
  return blocks.map((block, index) => {
    const actual = actualLines[index] ?? "";
    const expected = block.expected;
    const pass =
      expected === null ? true : normalizeExpected(expected) === normalizeActual(actual);
    return { lineIndex: block.callLine, pass, expected, actual };
  });
}

export async function runExamples(uri: { fsPath: string }): Promise<ExampleResult[]> {
  const vscode = await import("vscode");
  const ext = path.extname(uri.fsPath);
  const lang = langFromExt(ext);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
  const content = doc.getText();
  const blocks = parseExampleBlocks(content, lang);
  if (blocks.length === 0) return [];
  const { stdout, stderr } = await runSolutionFile(uri.fsPath, lang);
  if (stderr) {
    const ch = stderr.trim();
    if (ch && !stdout) throw new Error(ch);
  }
  return compareOutput(content, stdout, lang);
}
