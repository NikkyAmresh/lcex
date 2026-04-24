export type CharSet = "lowercase" | "uppercase" | "letters" | "digits" | "ascii" | "alphanumeric";

export interface ParamConstraint {
  name: string;
  min?: number;
  max?: number;
  charset?: CharSet;
  sorted?: "asc" | "desc";
  distinct?: boolean;
}

export interface ProblemConstraints {
  raw: string[];
  byName: Map<string, ParamConstraint>;
}

function stripHtml(html: string): string {
  let s = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<sup[^>]*>([^<]*)<\/sup>/gi, "^$1")
    .replace(/<sub[^>]*>([^<]*)<\/sub>/gi, "_$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&le;/g, "≤")
    .replace(/&ge;/g, "≥")
    .replace(/&quot;/g, '"');
  return s;
}

function parseNumericToken(tok: string): number | undefined {
  const t = tok.trim().replace(/[,_]/g, "");
  const sci = t.match(/^(-?)(\d+)\s*\*?\s*10\s*\^\s*(\d+)$/);
  if (sci) {
    const sign = sci[1] === "-" ? -1 : 1;
    return sign * Number(sci[2]) * Math.pow(10, Number(sci[3]));
  }
  const pow = t.match(/^(-?)10\s*\^\s*(\d+)$/);
  if (pow) {
    const sign = pow[1] === "-" ? -1 : 1;
    return sign * Math.pow(10, Number(pow[2]));
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

function extractConstraintLines(plain: string): string[] {
  const lines = plain.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim().replace(/^•\s*/, "").trim();
    if (!inside) {
      if (/^constraints?\s*:\s*$/i.test(trimmed)) {
        inside = true;
        continue;
      }
      const cMatch = trimmed.match(/^constraints?\s*:\s*(.+)$/i);
      if (cMatch) {
        inside = true;
        out.push(cMatch[1].trim());
      }
      continue;
    }
    if (!trimmed) continue;
    if (/^(examples?|follow[-\s]?up|notes?|hints?)\b\s*:?$/i.test(trimmed)) break;
    if (/^(examples?|follow[-\s]?up|notes?|hints?)\s*:\s*/i.test(trimmed)) break;
    out.push(trimmed);
  }
  return out.filter((s) => s.length > 0);
}

function upsert(byName: Map<string, ParamConstraint>, name: string): ParamConstraint {
  let c = byName.get(name);
  if (!c) {
    c = { name };
    byName.set(name, c);
  }
  return c;
}

const BOUND_RE = /(-?\s*(?:\d+\s*\*?\s*)?10\s*\^\s*\d+|-?\d[\d,_]*(?:\.\d+)?)\s*(?:<=|≤|&lt;=|&le;)\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*(?:<=|≤|&lt;=|&le;)\s*(-?\s*(?:\d+\s*\*?\s*)?10\s*\^\s*\d+|-?\d[\d,_]*(?:\.\d+)?)/;

const SINGLE_LE_RE = /([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*(?:<=|≤)\s*(-?\s*(?:\d+\s*\*?\s*)?10\s*\^\s*\d+|-?\d[\d,_]*(?:\.\d+)?)/;

const SINGLE_GE_RE = /([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*(?:>=|≥)\s*(-?\s*(?:\d+\s*\*?\s*)?10\s*\^\s*\d+|-?\d[\d,_]*(?:\.\d+)?)/;

function detectCharset(line: string): CharSet | undefined {
  const l = line.toLowerCase();
  if (/lowercase\s+english\s+letters?/.test(l)) return "lowercase";
  if (/uppercase\s+english\s+letters?/.test(l)) return "uppercase";
  if (/english\s+letters?/.test(l)) return "letters";
  if (/alphanumeric/.test(l)) return "alphanumeric";
  if (/digits?\s+(only|'\d'-'9')/.test(l) || /consists? of digits/.test(l)) return "digits";
  if (/printable\s+ascii/.test(l) || /ascii/.test(l)) return "ascii";
  return undefined;
}

function nameFromCharsetLine(line: string): string | undefined {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
  return m?.[1];
}

export function parseProblemConstraints(htmlOrText: string): ProblemConstraints {
  const plain = /<[^>]+>/.test(htmlOrText) ? stripHtml(htmlOrText) : htmlOrText;
  const raw = extractConstraintLines(plain);
  const byName = new Map<string, ParamConstraint>();

  for (const line of raw) {
    const bound = line.match(BOUND_RE);
    if (bound) {
      const lo = parseNumericToken(bound[1]);
      const hi = parseNumericToken(bound[3]);
      const c = upsert(byName, bound[2]);
      if (lo !== undefined) c.min = c.min !== undefined ? Math.max(c.min, lo) : lo;
      if (hi !== undefined) c.max = c.max !== undefined ? Math.min(c.max, hi) : hi;
      continue;
    }
    const le = line.match(SINGLE_LE_RE);
    if (le) {
      const hi = parseNumericToken(le[2]);
      const c = upsert(byName, le[1]);
      if (hi !== undefined) c.max = c.max !== undefined ? Math.min(c.max, hi) : hi;
    }
    const ge = line.match(SINGLE_GE_RE);
    if (ge) {
      const lo = parseNumericToken(ge[2]);
      const c = upsert(byName, ge[1]);
      if (lo !== undefined) c.min = c.min !== undefined ? Math.max(c.min, lo) : lo;
    }

    const charset = detectCharset(line);
    if (charset) {
      const name = nameFromCharsetLine(line);
      if (name) upsert(byName, name).charset = charset;
    }

    const sortedMatch = line.match(/([A-Za-z_][A-Za-z0-9_]*)\s+is\s+sorted(?:\s+in\s+(non-?decreasing|non-?increasing|ascending|descending|increasing|decreasing)\s+order)?/i);
    if (sortedMatch) {
      const dir = (sortedMatch[2] || "").toLowerCase();
      const c = upsert(byName, sortedMatch[1]);
      const isDesc = /non-?increasing|\bdescend|^decreasing/.test(dir);
      c.sorted = isDesc ? "desc" : "asc";
    }

    if (/distinct|unique|no duplicates/i.test(line)) {
      const nm = line.match(/^(?:All\s+(?:the\s+)?(?:integers|elements|values)\s+(?:of|in)\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
      if (nm) upsert(byName, nm[1]).distinct = true;
    }
  }

  return { raw, byName };
}
