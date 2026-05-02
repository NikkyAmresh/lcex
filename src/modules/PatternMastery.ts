import type * as vscode from "vscode";
import { PATTERNS, getPatternMeta, type PatternId } from "./PatternDetector";

/**
 * Per-pattern mastery telemetry. Persisted in VS Code globalState so it
 * survives reinstalls (provided the user remains signed in for cloud sync).
 *
 * The "forgetting score" is a half-life decay: each pattern starts at
 * mastery=0 on first solve, asymptotes towards 1.0 with repeated practice,
 * and decays back towards 0 over `HALF_LIFE_DAYS` of inactivity. This is
 * the same shape used in spaced-repetition systems (SuperMemo / Anki) and
 * is what drives the "weakest pattern" recommendation.
 */
export interface PatternMasteryEntry {
  patternId: PatternId;
  /** Total times this pattern was detected on a solve. */
  solvedCount: number;
  /** ISO timestamp of the most recent solve that detected this pattern. */
  lastSolvedAt?: string;
  /** Distinct slugs solved with this pattern (deduped). */
  slugsSolved: string[];
  /** Sum of last-solve `confidence` (max regex weight observed). Reserved for future weighting. */
  totalConfidence: number;
}

export interface PatternMasteryStateV1 {
  version: 1;
  byPattern: Partial<Record<PatternId, PatternMasteryEntry>>;
  /** Slugs that have already credited at least one pattern (avoids double-count on re-solve). */
  creditedSlugs: Record<string, true>;
}

export const PATTERN_MASTERY_KEY = "leetcode-practice.patternMastery";

const HALF_LIFE_DAYS = 21;

function emptyState(): PatternMasteryStateV1 {
  return { version: 1, byPattern: {}, creditedSlugs: {} };
}

export function readPatternMasteryState(memento: vscode.Memento): PatternMasteryStateV1 {
  const raw = memento.get<unknown>(PATTERN_MASTERY_KEY);
  if (!raw || typeof raw !== "object") return emptyState();
  const o = raw as Partial<PatternMasteryStateV1>;
  if (o.version !== 1) return emptyState();
  return {
    version: 1,
    byPattern: o.byPattern && typeof o.byPattern === "object" ? o.byPattern : {},
    creditedSlugs: o.creditedSlugs && typeof o.creditedSlugs === "object" ? o.creditedSlugs : {},
  };
}

async function writeState(memento: vscode.Memento, state: PatternMasteryStateV1): Promise<void> {
  await memento.update(PATTERN_MASTERY_KEY, state);
}

/**
 * Records a solved problem and its detected patterns. Idempotent on slug:
 * re-solving the same problem doesn't double-credit (we only refresh
 * lastSolvedAt). Returns the patterns that were credited (newly or refreshed).
 */
export async function recordSolveForPatterns(
  memento: vscode.Memento,
  titleSlug: string,
  detectedPatterns: PatternId[],
  now: Date = new Date(),
): Promise<{ creditedPatterns: PatternId[]; newPatterns: PatternId[] }> {
  if (detectedPatterns.length === 0) {
    return { creditedPatterns: [], newPatterns: [] };
  }
  const state = readPatternMasteryState(memento);
  const isoNow = now.toISOString();
  const alreadyCredited = state.creditedSlugs[titleSlug] === true;
  const newPatterns: PatternId[] = [];
  for (const pid of detectedPatterns) {
    const meta = getPatternMeta(pid);
    if (!meta) continue;
    let entry = state.byPattern[pid];
    if (!entry) {
      entry = {
        patternId: pid,
        solvedCount: 0,
        slugsSolved: [],
        totalConfidence: 0,
      };
      state.byPattern[pid] = entry;
    }
    if (!entry.slugsSolved.includes(titleSlug)) {
      entry.slugsSolved.push(titleSlug);
      entry.solvedCount += 1;
      entry.totalConfidence += 1;
      newPatterns.push(pid);
    }
    entry.lastSolvedAt = isoNow;
  }
  state.creditedSlugs[titleSlug] = true;
  await writeState(memento, state);
  return {
    creditedPatterns: detectedPatterns,
    newPatterns: alreadyCredited ? [] : newPatterns,
  };
}

/**
 * Mastery score in [0, 1]:
 *   raw = 1 - 1 / (1 + solvedCount)   ⟶ 0 → 0.5 → 0.667 → 0.75 ...
 *   decayed = raw * 0.5^(daysSince / HALF_LIFE_DAYS)
 */
export function computeMastery(entry: PatternMasteryEntry | undefined, now: Date = new Date()): number {
  if (!entry || entry.solvedCount === 0) return 0;
  const raw = 1 - 1 / (1 + entry.solvedCount);
  if (!entry.lastSolvedAt) return raw;
  const last = new Date(entry.lastSolvedAt).getTime();
  if (!Number.isFinite(last)) return raw;
  const days = Math.max(0, (now.getTime() - last) / (1000 * 60 * 60 * 24));
  const decay = Math.pow(0.5, days / HALF_LIFE_DAYS);
  return raw * decay;
}

export interface PatternMasterySummary {
  patternId: PatternId;
  label: string;
  blurb: string;
  icon: string;
  solvedCount: number;
  lastSolvedAt?: string;
  /** Days since lastSolvedAt; Infinity if never solved. */
  daysSinceLastSolve: number;
  /** Mastery in [0, 1] after time decay. */
  masteryScore: number;
  /** "🔥 strong" / "→ practiced" / "·  rusty" / "✗ untouched". */
  rank: "untouched" | "rusty" | "practiced" | "strong";
  leetcodeTag?: string;
}

export function summarizePatternMastery(
  memento: vscode.Memento,
  now: Date = new Date(),
): PatternMasterySummary[] {
  const state = readPatternMasteryState(memento);
  const out: PatternMasterySummary[] = [];
  for (const meta of PATTERNS) {
    const entry = state.byPattern[meta.id];
    const mastery = computeMastery(entry, now);
    const lastTs = entry?.lastSolvedAt ? new Date(entry.lastSolvedAt).getTime() : NaN;
    const daysSince = Number.isFinite(lastTs) ? (now.getTime() - lastTs) / (1000 * 60 * 60 * 24) : Infinity;
    let rank: PatternMasterySummary["rank"];
    if (!entry || entry.solvedCount === 0) rank = "untouched";
    else if (mastery < 0.2) rank = "rusty";
    else if (mastery < 0.5) rank = "practiced";
    else rank = "strong";
    out.push({
      patternId: meta.id,
      label: meta.label,
      blurb: meta.blurb,
      icon: meta.icon,
      solvedCount: entry?.solvedCount ?? 0,
      lastSolvedAt: entry?.lastSolvedAt,
      daysSinceLastSolve: daysSince,
      masteryScore: mastery,
      rank,
      leetcodeTag: meta.leetcodeTag,
    });
  }
  return out;
}

/**
 * Picks the pattern most worth practicing right now. Priority order:
 *   1. Untouched patterns first (covering blind spots beats reinforcing strengths).
 *   2. Among practiced ones, lowest mastery × longest days-since-solve.
 */
export function pickWeakestPattern(
  memento: vscode.Memento,
  now: Date = new Date(),
): PatternMasterySummary | undefined {
  const summary = summarizePatternMastery(memento, now);
  if (summary.length === 0) return undefined;
  const untouched = summary.filter((s) => s.rank === "untouched");
  if (untouched.length > 0) return untouched[0];
  return [...summary].sort((a, b) => {
    const aw = a.masteryScore * 1 + 1 / Math.max(1, a.daysSinceLastSolve);
    const bw = b.masteryScore * 1 + 1 / Math.max(1, b.daysSinceLastSolve);
    return aw - bw;
  })[0];
}

/** Dev/test helper: clears all pattern mastery state. */
export async function resetPatternMastery(memento: vscode.Memento): Promise<void> {
  await memento.update(PATTERN_MASTERY_KEY, undefined);
}
