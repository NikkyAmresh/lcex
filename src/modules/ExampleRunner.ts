import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import {
  getLanguageStrategy,
  languageFromFileExtension,
} from "./language/LanguageStrategy";
import { PY_ASSERT_MARKER } from "./language/PythonAssertHarness";

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

export interface ExampleBlock {
  callLine: number;
  expected: string | null;
  /** "assert" blocks report their own result (matched by line); "print" blocks match stdout in order. */
  kind: "print" | "assert";
}

export function parseExampleBlocks(
  content: string,
  lang: SupportedLanguage = "typescript"
): ExampleBlock[] {
  const s = getLanguageStrategy(lang);
  const results: ExampleBlock[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (s.isAssertExampleLine?.(line)) {
      results.push({ callLine: i + 1, expected: null, kind: "assert" });
    } else if (s.isExampleOutputLine(line)) {
      results.push({ callLine: i + 1, expected: s.parseExampleExpectedComment(line), kind: "print" });
    }
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

function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function tryParseNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  // Reject things like "[1]" that Number() coerces leniently
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function tryParseStructured(s: string): unknown {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  // Only attempt structural parse on things that look like lists/objects/strings/bools/null
  if (!/^[\[\{"'`tfnTFN]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  // Normalize Python-style literals to JSON: single quotes → double, True/False/None → true/false/null
  const pyToJson = trimmed
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  try {
    return JSON.parse(pyToJson);
  } catch {
    return undefined;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return Math.abs(a - b) < 1e-5;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

export function semanticallyEqual(expected: string, actual: string): boolean {
  const e = normalizeWhitespace(expected);
  const a = normalizeWhitespace(actual);
  if (e === a) return true;

  const en = tryParseNumber(e);
  const an = tryParseNumber(a);
  if (en !== null && an !== null) {
    return Math.abs(en - an) < 1e-5;
  }

  const ep = tryParseStructured(e);
  const ap = tryParseStructured(a);
  if (ep !== undefined && ap !== undefined) {
    return deepEqual(ep, ap);
  }

  return false;
}

interface AssertMarker {
  line: number;
  pass: boolean;
  actual: string;
  expected: string | null;
}

/** Pulls the harness's per-assert result lines out of stdout; returns them keyed by line plus the rest. */
function splitAssertMarkers(stdout: string): { markers: Map<number, AssertMarker>; rest: string } {
  const markers = new Map<number, AssertMarker>();
  const rest: string[] = [];
  for (const raw of stdout.split("\n")) {
    const at = raw.indexOf(PY_ASSERT_MARKER);
    if (at < 0) {
      rest.push(raw);
      continue;
    }
    if (at > 0) rest.push(raw.slice(0, at));
    try {
      const m = JSON.parse(raw.slice(at + PY_ASSERT_MARKER.length)) as AssertMarker;
      const prev = markers.get(m.line);
      // An assert inside a loop runs several times: keep the first failure.
      if (!prev || (prev.pass && !m.pass)) markers.set(m.line, m);
    } catch {
      rest.push(raw);
    }
  }
  return { markers, rest: rest.join("\n") };
}

export function compareOutput(
  content: string,
  stdout: string,
  lang: SupportedLanguage = "typescript"
): ExampleResult[] {
  const blocks = parseExampleBlocks(content, lang);
  const { markers, rest } = splitAssertMarkers(stdout);
  const actualLines = parseStdoutLines(rest);
  const results: ExampleResult[] = [];
  let printIndex = 0;
  for (const block of blocks) {
    if (block.kind === "assert") {
      // No marker → the assert never ran (e.g. inside a function body); not an example.
      const m = markers.get(block.callLine);
      if (m) results.push({ lineIndex: block.callLine, pass: m.pass, expected: m.expected, actual: m.actual });
      continue;
    }
    const actual = actualLines[printIndex++] ?? "";
    const expected = block.expected;
    const pass = expected === null ? true : semanticallyEqual(expected, actual);
    results.push({ lineIndex: block.callLine, pass, expected, actual });
  }
  return results;
}

export async function runExamples(uri: { fsPath: string }): Promise<ExampleResult[]> {
  // Lazy require (not dynamic import): the bundle is CJS with `vscode` external, so
  // esbuild emits a real `import("vscode")` that Node's ESM loader cannot resolve —
  // the extension host only exposes `vscode` through the CJS require hook.
  const vscode = require("vscode") as typeof import("vscode");
  const lang = languageFromPath(uri.fsPath);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
  const content = doc.getText();
  const blocks = parseExampleBlocks(content, lang);
  if (blocks.length === 0) return [];
  const { stdout, stderr } = await runSolutionFile(uri.fsPath, lang);
  const ch = stderr?.trim() ?? "";
  // Hard error: nothing on stdout but stderr present (typical for syntax / import errors).
  if (ch && !stdout) throw new Error(ch);
  // Soft error: partial stdout AND stderr — surface both so the user sees the
  // actual exception instead of a silent partial pass/fail.
  if (ch && stdout) {
    throw new Error(`Solution wrote partial output before erroring:\n--- stderr ---\n${ch}\n--- stdout ---\n${stdout.trim().slice(0, 4000)}`);
  }
  return compareOutput(content, stdout, lang);
}
