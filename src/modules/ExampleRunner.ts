import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import {
  getLanguageStrategy,
  languageFromFileExtension,
} from "./language/LanguageStrategy";

/** @deprecated Use SupportedLanguage from ./interface/Problem */
export type SolutionFileLang = SupportedLanguage;

export interface ExampleResult {
  lineIndex: number;
  pass: boolean;
  expected: string | null;
  actual: string;
}

function languageFromPath(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath);
  return languageFromFileExtension(ext) ?? "typescript";
}

export function parseExampleBlocks(
  content: string,
  lang: SupportedLanguage = "typescript"
): { callLine: number; expected: string | null }[] {
  const s = getLanguageStrategy(lang);
  const results: { callLine: number; expected: string | null }[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!s.isExampleOutputLine(line)) continue;
    results.push({ callLine: i + 1, expected: s.parseExampleExpectedComment(line) });
  }
  return results;
}

export async function runSolutionFile(
  filePath: string,
  lang?: SupportedLanguage
): Promise<{ stdout: string; stderr: string }> {
  const resolvedLang = lang ?? languageFromPath(filePath);
  const s = getLanguageStrategy(resolvedLang);
  const dir = path.dirname(filePath);
  const normalized = path.normalize(filePath);
  return s.runSolutionFile(normalized, dir);
}

/** @deprecated Use runSolutionFile */
export async function runTsFile(filePath: string): Promise<{ stdout: string; stderr: string }> {
  return runSolutionFile(filePath, "typescript");
}

function parseStdoutLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
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
  lang: SupportedLanguage = "typescript"
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
  const lang = languageFromPath(uri.fsPath);
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
