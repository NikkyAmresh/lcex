import type { SupportedLanguage } from "../interface/Problem";
import type { CallNode, FuncNode, LoopNode, ProgramIR, Span } from "./IR";

/**
 * Hand-rolled lightweight tokenizer-parsers for TS/JS/Python/C++.
 *
 * These are NOT full parsers — they extract just the IR shapes the complexity
 * engine needs: function definitions, loops (for/while), and call expressions.
 * They are robust on well-formatted LeetCode solutions, which is the input
 * profile we care about. Anything they can't classify resolves to `unknown`
 * downstream and the verdict is honestly labeled `low confidence`.
 */

export function tokenize(source: string, lang: SupportedLanguage): ProgramIR {
  if (lang === "python") return tokenizePython(source);
  return tokenizeBrace(source, lang);
}

/* ─────────────────────────── shared helpers ─────────────────────────── */

interface StripState {
  /** Source with strings/comments blanked out, preserving line + column offsets. */
  text: string;
  raw: string;
}

function stripStringsAndComments(source: string, lang: SupportedLanguage): StripState {
  const out: string[] = [];
  let i = 0;
  const N = source.length;
  const lineComment = "//"; // python uses # — handled separately
  while (i < N) {
    const c = source[i];
    const next = source[i + 1];
    if (lang !== "python" && c === "/" && next === "/") {
      while (i < N && source[i] !== "\n") {
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      continue;
    }
    if (lang !== "python" && c === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < N && !(source[i] === "*" && source[i + 1] === "/")) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < N) {
        out.push("  ");
        i += 2;
      }
      continue;
    }
    if (lang === "python" && c === "#") {
      while (i < N && source[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || (lang !== "cpp" && c === "`")) {
      const quote = c;
      out.push(c);
      i++;
      while (i < N && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < N) {
          out.push("  ");
          i += 2;
          continue;
        }
        if (source[i] === "\n") {
          out.push("\n");
          i++;
          continue;
        }
        // template-literal ${...}: keep so braces inside still balance
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          // bail out of string mode for the embedded expression
          out.push("${");
          i += 2;
          let depth = 1;
          while (i < N && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            out.push(source[i]);
            i++;
            if (depth === 0) break;
          }
          continue;
        }
        out.push(" ");
        i++;
      }
      if (i < N) {
        out.push(quote);
        i++;
      }
      continue;
    }
    if (lang === "python" && (c === '"' || c === "'") && source[i + 1] === c && source[i + 2] === c) {
      // triple-quoted string
      const quote = c;
      out.push("   ");
      i += 3;
      while (i < N && !(source[i] === quote && source[i + 1] === quote && source[i + 2] === quote)) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < N) {
        out.push("   ");
        i += 3;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return { text: out.join(""), raw: source };
}

function lineColOf(text: string, offset: number): { line: number; col: number } {
  let line = 0;
  let lineStart = 0;
  for (let k = 0; k < offset && k < text.length; k++) {
    if (text[k] === "\n") {
      line++;
      lineStart = k + 1;
    }
  }
  return { line, col: offset - lineStart };
}

function lineOf(text: string, offset: number): number {
  return lineColOf(text, offset).line;
}

function findMatchingBrace(text: string, openOffset: number): number {
  // openOffset must point at "{"
  let depth = 0;
  for (let i = openOffset; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingParen(text: string, openOffset: number): number {
  let depth = 0;
  for (let i = openOffset; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ─────────────────────── brace-language tokenizer ─────────────────────── */

interface CtxBrace {
  rawSource: string;
  stripped: string;
  enclosingFunc?: string;
}

function tokenizeBrace(source: string, lang: SupportedLanguage): ProgramIR {
  const stripped = stripStringsAndComments(source, lang).text;
  const ctx: CtxBrace = { rawSource: source, stripped };
  const functions: FuncNode[] = [];

  // Find function-like definitions. Patterns supported (in stripped text):
  //   function NAME(...) { ... }
  //   const|let|var NAME = (...) => { ... }     (or async ditto)
  //   NAME(...) { ... }                         (TS class methods)
  //   ReturnType NAME(...) { ... }              (C++ functions / methods)
  //   NAME = function(...) { ... }
  // We accept any "<word>(...) {" preceded by something that isn't a keyword
  // making it a control flow statement.

  const seen = new Set<number>();

  // 1. function NAME(
  const funcKeyword = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of stripped.matchAll(funcKeyword)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const fn = parseBraceFunctionAt(idx, m[1], stripped, source, ctx);
    if (fn) {
      functions.push(fn);
      seen.add(fn.span.startLine);
    }
  }

  // 2. NAME = ( ... ) => {  — arrow functions and assigned funcs
  const arrowAssign = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  for (const m of stripped.matchAll(arrowAssign)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    // find "(...) =>" or "(...) {"
    const parenStart = stripped.indexOf("(", idx + m[1].length);
    if (parenStart < 0) continue;
    const parenEnd = findMatchingParen(stripped, parenStart);
    if (parenEnd < 0) continue;
    const after = stripped.slice(parenEnd + 1, parenEnd + 8).replace(/\s+/g, "");
    if (!after.startsWith("=>{") && !after.startsWith("{")) continue;
    const braceStart = stripped.indexOf("{", parenEnd);
    if (braceStart < 0) continue;
    const fn = parseBraceFunctionAtBrace(idx, m[1], parenStart, parenEnd, braceStart, stripped, source, ctx);
    if (fn && !seen.has(fn.span.startLine)) {
      functions.push(fn);
      seen.add(fn.span.startLine);
    }
  }

  // 3. method-style `NAME(...) {` — class methods, C++ functions.
  // Walk the whole file and look for `[A-Za-z_][\w]*\s*\([...]\)\s*({|->|:)`.
  // This is generic and overlaps with case 1/2; dedupe via `seen`.
  const methodRe = /(^|[\s;{}])([A-Za-z_][\w]*)\s*\(/g;
  for (const m of stripped.matchAll(methodRe)) {
    const idx = (m.index ?? -1) + m[1].length;
    if (idx < 0) continue;
    const name = m[2];
    if (BRACE_KEYWORDS.has(name)) continue;
    const parenStart = stripped.indexOf("(", idx);
    if (parenStart < 0) continue;
    const parenEnd = findMatchingParen(stripped, parenStart);
    if (parenEnd < 0) continue;
    // Look for "{" within the next ~80 chars (allowing for ": ReturnType", "throws", "noexcept", etc.)
    const tail = stripped.slice(parenEnd + 1, parenEnd + 200);
    const braceRel = tail.indexOf("{");
    if (braceRel < 0) continue;
    // Reject if there's another '(' or ';' before the brace — that means this isn't a function head.
    const between = tail.slice(0, braceRel);
    if (/[;()=]/.test(between.replace(/^\s*:\s*[\w<>:,\s&*[\]]+/, "").replace(/\b(noexcept|const|override|final|throws[^{]*)\b/g, ""))) {
      // it's likely a call-with-block (e.g., `if (x) {`) — but `if` is in BRACE_KEYWORDS already
      continue;
    }
    const braceStart = parenEnd + 1 + braceRel;
    const fn = parseBraceFunctionAtBrace(m.index ?? idx, name, parenStart, parenEnd, braceStart, stripped, source, ctx);
    if (fn && !seen.has(fn.span.startLine)) {
      functions.push(fn);
      seen.add(fn.span.startLine);
    }
  }

  return { lang, source, functions };
}

const BRACE_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "return", "throw",
  "new", "delete", "typeof", "instanceof", "in", "of", "void", "yield", "await",
  "async", "function", "class", "interface", "type", "enum", "namespace",
  "public", "private", "protected", "static", "readonly", "abstract", "extends", "implements",
  "try", "catch", "finally", "with",
]);

function parseBraceFunctionAt(
  matchStart: number,
  name: string,
  stripped: string,
  source: string,
  ctx: CtxBrace,
): FuncNode | null {
  const parenStart = stripped.indexOf("(", matchStart);
  if (parenStart < 0) return null;
  const parenEnd = findMatchingParen(stripped, parenStart);
  if (parenEnd < 0) return null;
  const braceStart = stripped.indexOf("{", parenEnd);
  if (braceStart < 0) return null;
  return parseBraceFunctionAtBrace(matchStart, name, parenStart, parenEnd, braceStart, stripped, source, ctx);
}

function parseBraceFunctionAtBrace(
  matchStart: number,
  name: string,
  parenStart: number,
  parenEnd: number,
  braceStart: number,
  stripped: string,
  source: string,
  ctx: CtxBrace,
): FuncNode | null {
  const braceEnd = findMatchingBrace(stripped, braceStart);
  if (braceEnd < 0) return null;
  const startLineCol = lineColOf(stripped, matchStart);
  const endLine = lineOf(stripped, braceEnd);
  const span: Span = { startLine: startLineCol.line, endLine, startColumn: startLineCol.col };

  const paramsRaw = stripped.slice(parenStart + 1, parenEnd);
  const params = paramsRaw
    .split(",")
    .map((p) => p.trim())
    .map((p) => {
      // strip TS types ":Type"
      const eq = p.indexOf("=");
      if (eq >= 0) p = p.slice(0, eq).trim();
      const colon = p.indexOf(":");
      if (colon >= 0) p = p.slice(0, colon).trim();
      // strip C++/TS modifiers like "const X&", "X*", etc.
      const m = p.match(/([A-Za-z_$][\w$]*)\s*$/);
      return m ? m[1] : p;
    })
    .filter((p) => p.length > 0);

  const bodyOffset = braceStart + 1;
  const bodyText = stripped.slice(bodyOffset, braceEnd);
  const bodyOriginal = source.slice(bodyOffset, braceEnd);

  const loops = extractBraceLoops(stripped, bodyOffset, braceEnd, ctx);
  const calls = extractCallsInRange(stripped, bodyOffset, braceEnd, name);

  return { name, span, params, loops, calls, bodyText: bodyOriginal };
}

function extractBraceLoops(stripped: string, start: number, end: number, ctx: CtxBrace): LoopNode[] {
  const loops: LoopNode[] = [];
  let i = start;
  while (i < end) {
    const m = matchBraceLoopHeadAt(stripped, i, end);
    if (!m) {
      i++;
      continue;
    }
    loops.push(m.loop);
    i = m.bodyEnd;
  }
  return loops;
}

function matchBraceLoopHeadAt(
  stripped: string,
  i: number,
  end: number,
): { loop: LoopNode; bodyEnd: number } | null {
  // Identify a "for (" or "while (" or "do {" that starts at i (after skipping blank space we already aren't matching keywords mid-identifier)
  // Be careful to not match inside identifiers (e.g., `for_each`).
  if (!isIdentBoundary(stripped, i - 1)) return null;
  const word = stripped.slice(i, i + 6);
  let kind: "for" | "while" | null = null;
  let kwLen = 0;
  if (word.startsWith("for") && !isIdentChar(stripped[i + 3])) {
    kind = "for";
    kwLen = 3;
  } else if (word.startsWith("while") && !isIdentChar(stripped[i + 5])) {
    kind = "while";
    kwLen = 5;
  } else if (word.startsWith("do") && !isIdentChar(stripped[i + 2])) {
    // `do { ... } while (...)` — treat the body as a "while"-like loop
    kind = "while";
    kwLen = 2;
    let j = i + kwLen;
    while (j < end && /\s/.test(stripped[j])) j++;
    if (stripped[j] !== "{") return null;
    const bodyStart = j;
    const bodyEnd = findMatchingBrace(stripped, j);
    if (bodyEnd < 0 || bodyEnd > end) return null;
    // Optional trailing while(...)
    let after = bodyEnd + 1;
    while (after < end && /\s/.test(stripped[after])) after++;
    let headerText = "true";
    if (stripped.slice(after, after + 5) === "while") {
      const afterWhile = after + 5;
      let p = afterWhile;
      while (p < end && /\s/.test(stripped[p])) p++;
      if (stripped[p] === "(") {
        const close = findMatchingParen(stripped, p);
        if (close > 0) {
          headerText = stripped.slice(p + 1, close).trim();
          after = close + 1;
        }
      }
    }
    const startLineCol = lineColOf(stripped, i);
    const endLine = lineOf(stripped, bodyEnd);
    const span: Span = { startLine: startLineCol.line, endLine, startColumn: startLineCol.col };
    const bodyText = stripped.slice(bodyStart + 1, bodyEnd);
    const nestedLoops = extractBraceLoops(stripped, bodyStart + 1, bodyEnd, { rawSource: "", stripped });
    const calls = extractCallsInRange(stripped, bodyStart + 1, bodyEnd, undefined);
    return {
      loop: { kind: "while", span, headerText, bodyText, loops: nestedLoops, calls },
      bodyEnd: after,
    };
  } else {
    return null;
  }

  let j = i + kwLen;
  while (j < end && /\s/.test(stripped[j])) j++;
  if (stripped[j] !== "(") return null;
  const parenEnd = findMatchingParen(stripped, j);
  if (parenEnd < 0 || parenEnd > end) return null;
  const headerText = stripped.slice(j + 1, parenEnd).trim();

  let k = parenEnd + 1;
  while (k < end && /\s/.test(stripped[k])) k++;
  let bodyEnd: number;
  let bodyStart: number;
  let bodyContent: string;
  if (stripped[k] === "{") {
    bodyStart = k;
    const close = findMatchingBrace(stripped, k);
    if (close < 0 || close > end) return null;
    bodyEnd = close + 1;
    bodyContent = stripped.slice(k + 1, close);
  } else {
    // single-statement body — find end of statement (next ';')
    let p = k;
    let depth = 0;
    while (p < end) {
      const c = stripped[p];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === ";" && depth === 0) {
        break;
      }
      p++;
    }
    bodyStart = k;
    bodyEnd = Math.min(p + 1, end);
    bodyContent = stripped.slice(k, p);
  }
  const startLineCol = lineColOf(stripped, i);
  const endLine = lineOf(stripped, bodyEnd - 1);
  const span: Span = { startLine: startLineCol.line, endLine, startColumn: startLineCol.col };
  const nestedLoops = extractBraceLoops(stripped, bodyStart, bodyEnd, { rawSource: "", stripped });
  const calls = extractCallsInRange(stripped, bodyStart, bodyEnd, undefined);
  return {
    loop: { kind, span, headerText, bodyText: bodyContent, loops: nestedLoops, calls },
    bodyEnd,
  };
}

function isIdentChar(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9_$]/.test(c);
}

function isIdentBoundary(stripped: string, prevIdx: number): boolean {
  if (prevIdx < 0) return true;
  return !isIdentChar(stripped[prevIdx]);
}

/* ────────────────────────── Python tokenizer ────────────────────────── */

function tokenizePython(source: string): ProgramIR {
  const stripped = stripStringsAndComments(source, "python").text;
  const lines = stripped.split("\n");
  const rawLines = source.split("\n");
  const functions: FuncNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*)def\s+([A-Za-z_][\w]*)\s*\(/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const name = m[2];
    // gather params from the def line (handle wrapped param lists by reading until ":")
    let header = line;
    let endHeader = i;
    while (!/:\s*$/.test(header) && endHeader < lines.length - 1) {
      endHeader++;
      header += " " + lines[endHeader];
    }
    const parenStart = header.indexOf("(");
    const parenEnd = findMatchingParenInLine(header, parenStart);
    const paramsRaw = parenEnd > parenStart ? header.slice(parenStart + 1, parenEnd) : "";
    const params = paramsRaw
      .split(",")
      .map((p) => p.trim())
      .map((p) => {
        const eq = p.indexOf("=");
        if (eq >= 0) p = p.slice(0, eq).trim();
        const colon = p.indexOf(":");
        if (colon >= 0) p = p.slice(0, colon).trim();
        return p;
      })
      .filter((p) => p.length > 0 && p !== "self" && p !== "cls");

    // body = lines from endHeader+1 until the next non-blank line whose indent <= indent
    const bodyStart = endHeader + 1;
    let bodyEnd = lines.length - 1;
    for (let k = bodyStart; k < lines.length; k++) {
      const ln = lines[k];
      if (/^\s*$/.test(ln)) continue;
      const lineIndent = (/^(\s*)/.exec(ln)?.[1].length) ?? 0;
      if (lineIndent <= indent) {
        bodyEnd = k - 1;
        break;
      }
    }
    const bodyOriginal = rawLines.slice(bodyStart, bodyEnd + 1).join("\n");
    const span: Span = { startLine: i, endLine: bodyEnd, startColumn: indent };

    const { loops, calls } = parsePythonBlock(lines, bodyStart, bodyEnd, indent, name);

    functions.push({ name, span, params, loops, calls, bodyText: bodyOriginal });
  }
  return { lang: "python", source, functions };
}

function findMatchingParenInLine(line: string, openIdx: number): number {
  if (openIdx < 0) return -1;
  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    const c = line[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parsePythonBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  enclosingIndent: number,
  enclosingFunc?: string,
): { loops: LoopNode[]; calls: CallNode[] } {
  const loops: LoopNode[] = [];
  const calls: CallNode[] = [];
  let i = startLine;
  while (i <= endLine) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const indent = (/^(\s*)/.exec(line)?.[1].length) ?? 0;
    if (indent <= enclosingIndent) {
      // structurally outside the block — shouldn't happen in well-formed code
      break;
    }
    const trimmed = line.slice(indent);
    const forM = /^for\s+(.+?):\s*$/.exec(trimmed);
    const whileM = /^while\s+(.+?):\s*$/.exec(trimmed);
    if (forM || whileM) {
      const kind: "for" | "while" = forM ? "for" : "while";
      const headerText = (forM ? forM[1] : whileM![1]).trim();
      // body = lines after this whose indent > indent
      const bodyStart = i + 1;
      let bodyEndLine = endLine;
      for (let k = bodyStart; k <= endLine; k++) {
        const ln = lines[k];
        if (/^\s*$/.test(ln)) continue;
        const lineIndent = (/^(\s*)/.exec(ln)?.[1].length) ?? 0;
        if (lineIndent <= indent) {
          bodyEndLine = k - 1;
          break;
        }
      }
      const bodyText = lines.slice(bodyStart, bodyEndLine + 1).join("\n");
      const span: Span = { startLine: i, endLine: bodyEndLine, startColumn: indent };
      const nested = parsePythonBlock(lines, bodyStart, bodyEndLine, indent, enclosingFunc);
      const loopCalls = nested.calls;
      // also add direct loop calls
      const directCalls = extractCallsFromLines(lines, bodyStart, bodyEndLine, enclosingFunc);
      const seen = new Set(loopCalls.map((c) => `${c.line}:${c.raw}`));
      const allCalls = [...loopCalls];
      for (const c of directCalls) {
        const key = `${c.line}:${c.raw}`;
        if (!seen.has(key)) {
          allCalls.push(c);
          seen.add(key);
        }
      }
      loops.push({
        kind,
        span,
        headerText,
        bodyText,
        loops: nested.loops,
        calls: allCalls,
      });
      // Also accumulate calls into the enclosing function's call list
      for (const c of allCalls) {
        calls.push(c);
      }
      i = bodyEndLine + 1;
      continue;
    }
    // not a loop — just collect calls on this line
    for (const c of extractCallsFromLines(lines, i, i, enclosingFunc)) {
      calls.push(c);
    }
    i++;
  }
  return { loops, calls };
}

function extractCallsFromLines(
  lines: string[],
  startLine: number,
  endLine: number,
  enclosingFunc?: string,
): CallNode[] {
  const out: CallNode[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (line == null) continue;
    const re = /([A-Za-z_$][\w$.]*)\s*\(/g;
    for (const m of line.matchAll(re)) {
      const name = m[1];
      if (PY_KEYWORDS.has(name) || BRACE_KEYWORDS.has(name)) continue;
      // skip pure type/cast-like things
      const start = m.index ?? -1;
      if (start < 0) continue;
      // crude raw extraction: from name through matching ')'
      const open = line.indexOf("(", start + name.length);
      const close = findMatchingParenInLine(line, open);
      const raw = close > open ? line.slice(start, close + 1) : line.slice(start);
      const isSelfCall = enclosingFunc != null
        && (name === enclosingFunc
          || name === `self.${enclosingFunc}`
          || name === `this.${enclosingFunc}`);
      out.push({ name, raw, line: i, isSelfCall });
    }
  }
  return out;
}

const PY_KEYWORDS = new Set([
  "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is",
  "return", "yield", "raise", "import", "from", "as", "def", "class",
  "with", "try", "except", "finally", "lambda", "global", "nonlocal",
  "pass", "break", "continue", "assert", "del", "True", "False", "None",
  "print", // we still want print() as a call sometimes; keep in keywords for now
]);

/* ───────────────── shared call extractor for brace bodies ───────────────── */

function extractCallsInRange(
  stripped: string,
  start: number,
  end: number,
  enclosingFunc?: string,
): CallNode[] {
  const out: CallNode[] = [];
  // Within brace languages we have line-aware text via the line offsets.
  const slice = stripped.slice(start, end);
  const lineStart = lineOf(stripped, start);
  const re = /([A-Za-z_$][\w$.]*)\s*\(/g;
  for (const m of slice.matchAll(re)) {
    const name = m[1];
    if (BRACE_KEYWORDS.has(name)) continue;
    const localOffset = m.index ?? -1;
    if (localOffset < 0) continue;
    // local line within slice
    const local = slice.slice(0, localOffset);
    let local_line = 0;
    for (let i = 0; i < local.length; i++) if (local[i] === "\n") local_line++;
    const line = lineStart + local_line;
    const open = slice.indexOf("(", localOffset + name.length);
    const close = open >= 0 ? findMatchingParen(slice, open) : -1;
    const raw = close > open ? slice.slice(localOffset, close + 1) : slice.slice(localOffset);
    const isSelfCall = enclosingFunc != null
      && (name === enclosingFunc
        || name === `this.${enclosingFunc}`
        || name === `self.${enclosingFunc}`);
    out.push({ name, raw, line, isSelfCall });
  }
  return out;
}
