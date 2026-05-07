import type { ProblemConstraints, ParamConstraint } from "./ConstraintParser";
import { parseProblemConstraints } from "./ConstraintParser";

export interface EdgeCaseSuggestion {
  label: string;
  detail: string;
  severity: "suggest" | "warn";
}

function formatSize(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs === 1e9) return `${sign}10⁹`;
  if (abs === 1e8) return `${sign}10⁸`;
  if (abs === 1e7) return `${sign}10⁷`;
  if (abs === 1e6) return `${sign}10⁶`;
  if (abs === 1e5) return `${sign}10⁵`;
  if (abs === 1e4) return `${sign}10⁴`;
  if (abs === 1e3) return `${sign}10³`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(0)}·10⁹`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}·10⁶`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(0)}·10⁵`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}·10⁴`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}k`;
  return String(n);
}

function isArrayLike(name: string): boolean {
  return /\.length$/.test(name);
}

function baseOf(name: string): string {
  return name.replace(/\.length$/, "").replace(/\[[^\]]*\]$/, "");
}

/** Infer high-signal edge-case probes from parsed constraints. */
export function buildEdgeCaseSuggestions(c: ProblemConstraints): EdgeCaseSuggestion[] {
  const out: EdgeCaseSuggestion[] = [];
  const seen = new Set<string>();
  const push = (label: string, detail: string, severity: "suggest" | "warn" = "suggest") => {
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ label, detail, severity });
  };

  const params: ParamConstraint[] = [...c.byName.values()];

  for (const p of params) {
    if (isArrayLike(p.name)) {
      const base = baseOf(p.name);
      if ((p.min ?? 1) <= 0) push(`${base}=[]`, `${base} with length 0 (min lower-bound is ${p.min ?? "?"})`);
      if ((p.min ?? 1) <= 1) push(`${base}=[x]`, `single-element ${base} (length 1)`);
      if (p.max !== undefined) {
        const size = p.max;
        const severity: "suggest" | "warn" = size >= 50_000 ? "warn" : "suggest";
        push(
          `${base} size=${formatSize(size)}`,
          `max-size ${base} — stress test. May TLE quadratic solutions.`,
          severity
        );
      }
    }
  }

  for (const p of params) {
    if (p.name.includes("[i]") || p.name.includes("[j]")) {
      const base = baseOf(p.name);
      if (p.min !== undefined && p.min < 0) {
        push(`${base} with negatives`, `${base}[i] range includes negative values (min=${p.min})`);
      }
      if (p.min !== undefined && p.max !== undefined && p.min <= 0 && p.max >= 0) {
        push(`${base} with zeros`, `${base}[i] spans zero`);
      }
      if (p.max !== undefined && Math.abs(p.max) >= 1e9) {
        push(`${base} at int bounds`, `${base}[i] may hit integer overflow near ±${formatSize(p.max)}`, "warn");
      }
    }
  }

  for (const p of params) {
    const base = baseOf(p.name);
    if (p.sorted === "asc") {
      push(`${base} reverse-sorted`, `${base} is promised sorted asc — try reverse to verify no sort-dep`);
    }
    if (p.distinct) {
      push(`${base} with duplicates`, `${base} is promised distinct — verify behavior when duplicates appear`);
    }
    if (p.charset === "lowercase") {
      push(`uppercase in ${base}`, `charset is lowercase — verify your case-sensitivity assumptions`);
    }
    if (p.charset === "ascii") {
      push(`unicode in ${base}`, `charset is ASCII — unicode should not leak in`);
    }
  }

  return out;
}

export interface AdversarialSummary {
  signatureLine: string;
  signatureHover: string;
  perCase: { label: string; detail: string; severity: "suggest" | "warn" }[];
}

/** Build a one-line summary + detailed list of edge-case probes for a problem. */
export function buildAdversarialSummary(problemContent: string): AdversarialSummary {
  const constraints = parseProblemConstraints(problemContent);
  const cases = buildEdgeCaseSuggestions(constraints);
  if (cases.length === 0) {
    return {
      signatureLine: "  ⓘ no structured constraints detected",
      signatureHover:
        "lcex: could not parse a `Constraints:` section from this problem's description.",
      perCase: [],
    };
  }
  const short = cases.slice(0, 5).map((c) => c.label).join(" · ");
  const more = cases.length > 5 ? ` · +${cases.length - 5} more` : "";
  const hoverLines = [
    "**lcex: edge cases to probe**",
    "",
    ...cases.map((c) => `- **${c.label}** — ${c.detail}`),
    "",
    "_Derived from parsed constraints. Next iteration will auto-run these._",
  ];
  return {
    signatureLine: `  ⚠ try: ${short}${more}`,
    signatureHover: hoverLines.join("\n"),
    perCase: cases,
  };
}

/** Find the line number (0-based) of the function/class signature in a solution file. */
export function findSignatureLine(content: string, language: string): number {
  const lines = content.split("\n");
  const patterns: RegExp[] =
    language === "python"
      ? [/^\s*class\s+Solution\b/, /^\s*def\s+\w+\s*\(/]
      : language === "cpp" || language === "java"
        ? [/^\s*(?:class|struct)\s+Solution\b/, /\b[A-Za-z_][A-Za-z0-9_]*\s+\w+\s*\([^)]*\)\s*\{/]
        : [/^\s*function\s+\w+\s*\(/, /^\s*const\s+\w+\s*=\s*\(/, /^\s*(var|let)\s+\w+\s*=/];
  for (const pat of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pat.test(lines[i])) return i;
    }
  }
  return 0;
}
