import type { SupportedLanguage } from "./interface/Problem";

export type LintRuleId = "mutate-input" | "debug-print" | "builtin-sort" | "magic-number";

export type LintSeverity = "warning" | "info";

export interface LintFinding {
  line: number;
  column: number;
  endColumn: number;
  rule: LintRuleId;
  severity: LintSeverity;
  message: string;
  inlineHint: string;
}

const MUTATORS_JSLIKE = ["sort", "reverse", "push", "pop", "splice", "shift", "unshift", "fill", "copyWithin"];
const MUTATORS_PY = ["sort", "reverse", "append", "extend", "insert", "clear", "pop", "remove"];

const MAGIC_NUMBERS = new Set([
  "26", "52",
  "127", "128", "255", "256",
  "1000000007", "998244353", "1000000009",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSuppressComment(line: string, rule: LintRuleId): boolean {
  const re = new RegExp(`lcex-lint-ignore\\s*:\\s*(?:${rule}|all)\\b`);
  return re.test(line);
}

function isCommentedOut(line: string, col: number, lang: SupportedLanguage): boolean {
  const prefix = line.slice(0, col);
  if (lang === "python") return prefix.lastIndexOf("#") !== -1 && !prefix.includes("#!");
  return /\/\//.test(prefix);
}

function inStringLiteral(line: string, col: number): boolean {
  let single = 0;
  let double = 0;
  let back = 0;
  for (let i = 0; i < col; i++) {
    const ch = line[i];
    const prev = line[i - 1];
    if (prev === "\\") continue;
    if (ch === '"' && back % 2 === 0 && single % 2 === 0) double++;
    else if (ch === "'" && back % 2 === 0 && double % 2 === 0) single++;
    else if (ch === "`" && single % 2 === 0 && double % 2 === 0) back++;
  }
  return single % 2 === 1 || double % 2 === 1 || back % 2 === 1;
}

export function extractParamNames(source: string, lang: SupportedLanguage): string[] {
  let paramBlob = "";
  if (lang === "python") {
    const m = source.match(/def\s+\w+\s*\(([^)]*)\)/);
    paramBlob = m?.[1] ?? "";
    return paramBlob
      .split(",")
      .map((p) => p.trim().split(":")[0].replace(/^\*+/, "").split("=")[0].trim())
      .filter((p) => p && p !== "self" && p !== "cls");
  }
  if (lang === "cpp") {
    const m = source.match(/\b\w[\w:<>*&\s,]*\s+\w+\s*\(([^)]*)\)\s*(?:const)?\s*\{/);
    paramBlob = m?.[1] ?? "";
    return paramBlob
      .split(",")
      .map((p) => {
        const tok = p.trim().split(/\s+/).filter(Boolean);
        if (tok.length === 0) return "";
        return tok[tok.length - 1].replace(/[&*\[\]]/g, "");
      })
      .filter(Boolean);
  }
  const m = source.match(/function\s+\w+\s*\(([^)]*)\)/);
  paramBlob = m?.[1] ?? "";
  return paramBlob
    .split(",")
    .map((p) =>
      p
        .trim()
        .replace(/^\.{3}/, "")
        .split(":")[0]
        .split("=")[0]
        .trim()
    )
    .filter(Boolean);
}

function printRegex(lang: SupportedLanguage): RegExp {
  if (lang === "python") return /\bprint\s*\(/;
  if (lang === "cpp") return /(?:std::)?cout\s*<</;
  return /\bconsole\.log\s*\(/;
}

export function lintSolutionSource(source: string, lang: SupportedLanguage): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = source.split("\n");
  const params = extractParamNames(source, lang);
  const mutators = lang === "python" ? MUTATORS_PY : MUTATORS_JSLIKE;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!hasSuppressComment(line, "mutate-input")) {
      for (const param of params) {
        for (const method of mutators) {
          const re = new RegExp(`\\b${escapeRegex(param)}\\.${method}\\b\\s*\\(`);
          const m = re.exec(line);
          if (!m || m.index === undefined) continue;
          if (isCommentedOut(line, m.index, lang)) continue;
          if (inStringLiteral(line, m.index)) continue;
          findings.push({
            line: i,
            column: m.index,
            endColumn: m.index + m[0].length - 1,
            rule: "mutate-input",
            severity: "warning",
            message: `Mutates input parameter '${param}' via .${method}(). Clone before mutating if caller owns '${param}'.`,
            inlineHint: `⚠ mutates input '${param}'`,
          });
          break;
        }
      }
    }

    if (!hasSuppressComment(line, "builtin-sort")) {
      const re = /\b(\w+)\.sort\b\s*\(/;
      const m = re.exec(line);
      if (m && m.index !== undefined && !isCommentedOut(line, m.index, lang) && !inStringLiteral(line, m.index)) {
        findings.push({
          line: i,
          column: m.index,
          endColumn: m.index + m[0].length - 1,
          rule: "builtin-sort",
          severity: "info",
          message: `Built-in .sort() on '${m[1]}'. If this problem tests sorting, derive the algorithm yourself.`,
          inlineHint: `ⓘ built-in sort`,
        });
      }
    }

    if (!hasSuppressComment(line, "magic-number")) {
      const isDirectLiteralAssignment =
        /^\s*(?:const|let|var|final|static|constexpr)\s+\w+(?:\s*:\s*[\w<>,\s]+)?\s*=\s*-?\d+\s*;?\s*(?:\/\/.*|#.*)?$/.test(line) ||
        /^\s*#\s*define\s+\w+\s+-?\d+\s*(?:\/\/.*)?$/.test(line) ||
        /^\s*[A-Z_][A-Z0-9_]*\s*(?::\s*\w+)?\s*=\s*-?\d+\s*(?:#.*)?$/.test(line);
      if (!isDirectLiteralAssignment) {
        const numRe = /\b(\d{2,})\b/g;
        let nm: RegExpExecArray | null;
        while ((nm = numRe.exec(line)) !== null) {
          if (!MAGIC_NUMBERS.has(nm[1])) continue;
          if (isCommentedOut(line, nm.index, lang)) continue;
          if (inStringLiteral(line, nm.index)) continue;
          findings.push({
            line: i,
            column: nm.index,
            endColumn: nm.index + nm[1].length,
            rule: "magic-number",
            severity: "info",
            message: `Magic number ${nm[1]}. Name it (ALPHABET_SIZE=26, MOD=1e9+7, BYTE=256) so intent is clear.`,
            inlineHint: `ⓘ magic ${nm[1]}`,
          });
        }
      }
    }
  }

  if (true) {
    const pr = printRegex(lang);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (hasSuppressComment(line, "debug-print")) continue;
      const m = pr.exec(line);
      if (!m || m.index === undefined) continue;
      if (isCommentedOut(line, m.index, lang)) continue;
      const indent = /^(\s*)/.exec(line)?.[1].length ?? 0;
      if (indent === 0) continue;
      const hasExpected = /(#|\/\/)\s*(expected|→|->)/i.test(line);
      if (hasExpected) continue;
      findings.push({
        line: i,
        column: m.index,
        endColumn: m.index + m[0].length - 1,
        rule: "debug-print",
        severity: "info",
        message: `Debug print inside function body without an 'expected: …' comment — likely leftover from debugging.`,
        inlineHint: `ⓘ debug print?`,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

export function firstFindingPerLine(findings: LintFinding[]): LintFinding[] {
  const seen = new Set<number>();
  const out: LintFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.line)) continue;
    seen.add(f.line);
    out.push(f);
  }
  return out;
}
