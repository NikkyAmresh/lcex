import type * as vscode from "vscode";
import type { Problem } from "./interface/Problem";
import type { ProblemListItem } from "./LeetCode";
import { PATTERNS, type PatternId, type PatternMeta } from "./PatternDetector";

/**
 * Pattern Recognition Drill — train the "what approach is this?" reflex.
 *
 * The drill shows a problem statement with the pattern scrubbed out, gives the
 * user up to five minutes to recall the approach, then reveals the canonical
 * pattern(s) and lets them self-grade. Ground truth comes for free from the
 * problem's LeetCode `topicTags`: any tag matching a `PatternMeta.leetcodeTag`
 * is treated as a correct answer, so no AI or extra data source is needed.
 *
 * Result history is persisted in globalState (same survives-reinstall story as
 * the pattern mastery dashboard) and drives the accuracy / streak header.
 */

/** Per-question think time before the answer auto-reveals (ms). */
export const DRILL_TIMEOUT_MS = 5 * 60 * 1000;

export interface PatternDrillPerPattern {
  patternId: PatternId;
  asked: number;
  correct: number;
}

export interface PatternDrillStateV1 {
  version: 1;
  byPattern: Partial<Record<PatternId, PatternDrillPerPattern>>;
  totalAsked: number;
  totalCorrect: number;
  currentStreak: number;
  bestStreak: number;
  lastDrilledAt?: string;
}

export const PATTERN_DRILL_KEY = "leetcode-practice.patternDrill";

function emptyState(): PatternDrillStateV1 {
  return {
    version: 1,
    byPattern: {},
    totalAsked: 0,
    totalCorrect: 0,
    currentStreak: 0,
    bestStreak: 0,
  };
}

export function readPatternDrillState(memento: vscode.Memento): PatternDrillStateV1 {
  const raw = memento.get<unknown>(PATTERN_DRILL_KEY);
  if (!raw || typeof raw !== "object") return emptyState();
  const o = raw as Partial<PatternDrillStateV1>;
  if (o.version !== 1) return emptyState();
  return {
    version: 1,
    byPattern: o.byPattern && typeof o.byPattern === "object" ? o.byPattern : {},
    totalAsked: typeof o.totalAsked === "number" ? o.totalAsked : 0,
    totalCorrect: typeof o.totalCorrect === "number" ? o.totalCorrect : 0,
    currentStreak: typeof o.currentStreak === "number" ? o.currentStreak : 0,
    bestStreak: typeof o.bestStreak === "number" ? o.bestStreak : 0,
    ...(typeof o.lastDrilledAt === "string" ? { lastDrilledAt: o.lastDrilledAt } : {}),
  };
}

/** A snapshot of the running stats shown in the drill header. */
export interface PatternDrillStats {
  totalAsked: number;
  totalCorrect: number;
  accuracyPct: number;
  currentStreak: number;
  bestStreak: number;
}

export function drillStats(state: PatternDrillStateV1): PatternDrillStats {
  const accuracyPct =
    state.totalAsked > 0 ? Math.round((state.totalCorrect / state.totalAsked) * 100) : 0;
  return {
    totalAsked: state.totalAsked,
    totalCorrect: state.totalCorrect,
    accuracyPct,
    currentStreak: state.currentStreak,
    bestStreak: state.bestStreak,
  };
}

/**
 * Records one graded attempt. `patternIds` are the correct patterns for the
 * problem; we credit each one's per-pattern tally and roll the global streak.
 */
export async function recordDrillResult(
  memento: vscode.Memento,
  patternIds: PatternId[],
  correct: boolean,
  now: Date = new Date(),
): Promise<PatternDrillStats> {
  const state = readPatternDrillState(memento);
  for (const pid of patternIds) {
    let entry = state.byPattern[pid];
    if (!entry) {
      entry = { patternId: pid, asked: 0, correct: 0 };
      state.byPattern[pid] = entry;
    }
    entry.asked += 1;
    if (correct) entry.correct += 1;
  }
  state.totalAsked += 1;
  if (correct) {
    state.totalCorrect += 1;
    state.currentStreak += 1;
    if (state.currentStreak > state.bestStreak) state.bestStreak = state.currentStreak;
  } else {
    state.currentStreak = 0;
  }
  state.lastDrilledAt = now.toISOString();
  await memento.update(PATTERN_DRILL_KEY, state);
  return drillStats(state);
}

/** Dev/test helper: clears all drill history. */
export async function resetPatternDrill(memento: vscode.Memento): Promise<void> {
  await memento.update(PATTERN_DRILL_KEY, undefined);
}

const PATTERNS_BY_TAG: Map<string, PatternMeta[]> = (() => {
  const m = new Map<string, PatternMeta[]>();
  for (const p of PATTERNS) {
    if (!p.leetcodeTag) continue;
    const list = m.get(p.leetcodeTag) ?? [];
    list.push(p);
    m.set(p.leetcodeTag, list);
  }
  return m;
})();

/** Maps a problem's topic tags to the patterns we recognise. Deduped by id. */
export function patternsForTags(topicTags: readonly string[] | undefined): PatternMeta[] {
  if (!topicTags || topicTags.length === 0) return [];
  const seen = new Set<PatternId>();
  const out: PatternMeta[] = [];
  for (const tag of topicTags) {
    for (const meta of PATTERNS_BY_TAG.get(tag) ?? []) {
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push(meta);
    }
  }
  return out;
}

/** True when the item carries at least one pattern-mapped tag (drillable). */
export function isDrillable(item: ProblemListItem): boolean {
  return patternsForTags(item.topicTags).length > 0;
}

export interface DrillQuestion {
  titleSlug: string;
  title: string;
  difficulty: string;
  /** Problem statement HTML, with topic-tag hints scrubbed. */
  statementHtml: string;
  /** Canonical pattern answers for this problem. */
  answers: Array<{ id: PatternId; label: string; blurb: string; icon: string }>;
}

/**
 * Removes obvious tag/topic giveaways from the statement so the answer isn't
 * handed to the user. LeetCode statements rarely embed the tag list, but the
 * "Related Topics" / "Topics" trailer and bare pattern names are stripped to
 * be safe. Best-effort and non-destructive to the core prose.
 */
function scrubStatement(html: string): string {
  let out = html;
  // Drop any "Topics"/"Related Topics"/"Companies" trailer block to the end.
  out = out.replace(/<[^>]*>\s*(Related\s+Topics|Topics|Companies)\s*[:<][\s\S]*$/i, "");
  return out;
}

/** Builds a drill question from a fetched problem and its list item (for tags). */
export function buildDrillQuestion(
  problem: Problem,
  item: ProblemListItem,
): DrillQuestion | null {
  const metas = patternsForTags(item.topicTags);
  if (metas.length === 0) return null;
  return {
    titleSlug: problem.titleSlug,
    title: problem.title,
    difficulty: problem.difficulty,
    statementHtml: scrubStatement(problem.content ?? ""),
    answers: metas.map((m) => ({ id: m.id, label: m.label, blurb: m.blurb, icon: m.icon })),
  };
}

/** Picks a random drillable item, avoiding an immediate repeat when possible. */
export function pickRandomDrillItem(
  items: readonly ProblemListItem[],
  excludeSlug?: string,
): ProblemListItem | undefined {
  const pool = items.filter(isDrillable);
  if (pool.length === 0) return undefined;
  const avoided = excludeSlug ? pool.filter((p) => p.titleSlug !== excludeSlug) : pool;
  const from = avoided.length > 0 ? avoided : pool;
  return from[Math.floor(Math.random() * from.length)];
}
