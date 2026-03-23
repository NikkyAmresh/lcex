import * as path from "path";
import * as vscode from "vscode";
import { addBonusXp, xpForDifficultyLabel } from "./Gamification";

export const INTERVIEW_SESSION_KEY = "leetcode-practice.interviewSession";
export const INTERVIEW_HISTORY_KEY = "leetcode-practice.interviewHistory";

export const INTERVIEW_MODE_CONTEXT = "leetcodePractice.interviewMode";

export interface PlannedInterviewProblem {
  titleSlug: string;
  difficulty: string;
}

export interface InterviewSessionState {
  active: boolean;
  startedAt: number;
  endsAt: number;
  plannedProblems: PlannedInterviewProblem[];
  solvedDuringSession: string[];
  durationMinutes: number;
  /** Seconds spent while this problem was the focused interview problem (wall-clock tick). */
  interviewTimeBySlug: Record<string, number>;
  /** Which planned problem receives time ticks (last opened / focused in interview). */
  interviewFocusSlug?: string;
  /** Absolute path to `.lcInterview` when session was started from that file (report written on end). */
  sourceLcInterviewPath?: string;
  /** Display name for reports (from file or chosen at start). */
  interviewName?: string;
  /** Solutions for this session are created/resolved only under this directory. */
  solutionFolderPath?: string;
  /** Three-digit hex id for this attempt; solution/report files use this suffix. */
  attemptHex?: string;
}

/** Per planned problem on the interview report (time + interview-only XP). */
export interface InterviewPerProblemStat {
  titleSlug: string;
  title: string;
  secondsSpent: number;
  solvedInInterview: boolean;
  interviewXpEarned: number;
}

/** Per-session interview rewards (persisted for stats / report). */
export interface InterviewXpBreakdown {
  easyXp: number;
  mediumXp: number;
  hardXp: number;
  unknownXp: number;
  perfectBonusXp: number;
}

export interface InterviewHistoryEntry {
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  plannedCount: number;
  solvedCount: number;
  /** Total interview bonus XP (0 if nothing solved in session). */
  bonusXp: number;
  plannedSlugs: string[];
  solvedSlugs: string[];
  plannedProblems?: PlannedInterviewProblem[];
  xpBreakdown?: InterviewXpBreakdown;
  /** Time on each problem + per-problem interview XP (when tracked). */
  perProblem?: InterviewPerProblemStat[];
}

const MAX_HISTORY = 50;
/** Extra XP when every planned problem was solved during the session. */
const INTERVIEW_PERFECT_SET_BONUS = 30;

function migrateRawSession(raw: unknown): InterviewSessionState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Partial<InterviewSessionState> & { plannedSlugs?: string[] };
  if (!s.active || typeof s.startedAt !== "number" || typeof s.endsAt !== "number") return undefined;
  let plannedProblems = s.plannedProblems;
  if (!Array.isArray(plannedProblems) || plannedProblems.length === 0) {
    const slugs = Array.isArray(s.plannedSlugs) ? s.plannedSlugs : [];
    plannedProblems = slugs
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map((titleSlug) => ({ titleSlug, difficulty: "MEDIUM" }));
  } else {
    plannedProblems = plannedProblems.map((p) => ({
      titleSlug: String(p.titleSlug).trim(),
      difficulty: String(p.difficulty || "MEDIUM").toUpperCase(),
    }));
  }
  const sourceLcInterviewPath =
    typeof s.sourceLcInterviewPath === "string" && s.sourceLcInterviewPath.trim()
      ? s.sourceLcInterviewPath.trim()
      : undefined;
  const interviewName =
    typeof s.interviewName === "string" && s.interviewName.trim() ? s.interviewName.trim() : undefined;
  const solutionFolderPath =
    typeof s.solutionFolderPath === "string" && s.solutionFolderPath.trim()
      ? path.resolve(s.solutionFolderPath.trim())
      : undefined;
  const rawHex = typeof s.attemptHex === "string" ? s.attemptHex.trim().toLowerCase() : "";
  const attemptHex = /^[0-9a-f]{3}$/.test(rawHex) ? rawHex : undefined;
  const extra = s as Partial<{
    interviewTimeBySlug: Record<string, unknown>;
    interviewFocusSlug: string;
  }>;
  const interviewTimeBySlug: Record<string, number> = {};
  if (extra.interviewTimeBySlug && typeof extra.interviewTimeBySlug === "object") {
    for (const [k, v] of Object.entries(extra.interviewTimeBySlug)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        interviewTimeBySlug[k] = v;
      }
    }
  }
  const interviewFocusSlug =
    typeof extra.interviewFocusSlug === "string" && extra.interviewFocusSlug.trim()
      ? extra.interviewFocusSlug.trim()
      : undefined;
  return {
    active: true,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    plannedProblems,
    solvedDuringSession: Array.isArray(s.solvedDuringSession) ? [...s.solvedDuringSession] : [],
    durationMinutes: typeof s.durationMinutes === "number" ? s.durationMinutes : 45,
    interviewTimeBySlug,
    ...(interviewFocusSlug ? { interviewFocusSlug } : {}),
    ...(sourceLcInterviewPath ? { sourceLcInterviewPath } : {}),
    ...(interviewName ? { interviewName } : {}),
    ...(solutionFolderPath ? { solutionFolderPath } : {}),
    ...(attemptHex ? { attemptHex } : {}),
  };
}

export function getInterviewSession(memento: vscode.Memento): InterviewSessionState | undefined {
  const raw = memento.get<unknown>(INTERVIEW_SESSION_KEY);
  return migrateRawSession(raw);
}

export function getInterviewHistory(memento: vscode.Memento): InterviewHistoryEntry[] {
  const h = memento.get<InterviewHistoryEntry[]>(INTERVIEW_HISTORY_KEY);
  return Array.isArray(h) ? h : [];
}

export async function setInterviewContext(active: boolean): Promise<void> {
  await vscode.commands.executeCommand("setContext", INTERVIEW_MODE_CONTEXT, active);
}

export type StartInterviewSessionOptions = {
  sourceLcInterviewPath?: string;
  interviewName?: string;
  solutionFolderPath?: string;
  attemptHex?: string;
};

export async function startInterviewSession(
  memento: vscode.Memento,
  durationMinutes: 45 | 60 | 180,
  plannedProblems: PlannedInterviewProblem[],
  options?: StartInterviewSessionOptions
): Promise<void> {
  const now = Date.now();
  const dedup = new Map<string, PlannedInterviewProblem>();
  for (const p of plannedProblems) {
    const slug = p.titleSlug.trim();
    if (!slug) continue;
    if (!dedup.has(slug)) {
      dedup.set(slug, { titleSlug: slug, difficulty: (p.difficulty || "MEDIUM").toUpperCase() });
    }
  }
  const list = [...dedup.values()];
  const sourceLcInterviewPath =
    typeof options?.sourceLcInterviewPath === "string" && options.sourceLcInterviewPath.trim()
      ? options.sourceLcInterviewPath.trim()
      : undefined;
  const interviewName =
    typeof options?.interviewName === "string" && options.interviewName.trim()
      ? options.interviewName.trim()
      : undefined;
  const solutionFolderPath =
    typeof options?.solutionFolderPath === "string" && options.solutionFolderPath.trim()
      ? path.resolve(options.solutionFolderPath.trim())
      : undefined;
  const rawOptHex =
    typeof options?.attemptHex === "string" ? options.attemptHex.trim().toLowerCase() : "";
  const attemptHex = /^[0-9a-f]{3}$/.test(rawOptHex) ? rawOptHex : undefined;
  const state: InterviewSessionState = {
    active: true,
    startedAt: now,
    endsAt: now + durationMinutes * 60_000,
    plannedProblems: list,
    solvedDuringSession: [],
    durationMinutes,
    interviewTimeBySlug: {},
    ...(sourceLcInterviewPath ? { sourceLcInterviewPath } : {}),
    ...(interviewName ? { interviewName } : {}),
    ...(solutionFolderPath ? { solutionFolderPath } : {}),
    ...(attemptHex ? { attemptHex } : {}),
  };
  await memento.update(INTERVIEW_SESSION_KEY, state);
  await setInterviewContext(true);
}

export async function recordInterviewSolve(memento: vscode.Memento, titleSlug: string): Promise<void> {
  const s = getInterviewSession(memento);
  if (!s?.active) return;
  if (s.solvedDuringSession.includes(titleSlug)) return;
  const next: InterviewSessionState = {
    ...s,
    solvedDuringSession: [...s.solvedDuringSession, titleSlug],
  };
  await memento.update(INTERVIEW_SESSION_KEY, next);
}

export async function incrementInterviewTimeForFocusedProblem(memento: vscode.Memento): Promise<void> {
  const s = getInterviewSession(memento);
  if (!s?.active || !s.interviewFocusSlug) return;
  const map = { ...s.interviewTimeBySlug };
  const slug = s.interviewFocusSlug;
  map[slug] = (map[slug] ?? 0) + 1;
  const next: InterviewSessionState = { ...s, interviewTimeBySlug: map };
  await memento.update(INTERVIEW_SESSION_KEY, next);
}

export async function setInterviewFocusProblem(memento: vscode.Memento, titleSlug: string): Promise<void> {
  const s = getInterviewSession(memento);
  if (!s?.active) return;
  if (s.interviewFocusSlug === titleSlug) return;
  const next: InterviewSessionState = { ...s, interviewFocusSlug: titleSlug };
  await memento.update(INTERVIEW_SESSION_KEY, next);
}

async function appendHistory(memento: vscode.Memento, entry: InterviewHistoryEntry): Promise<void> {
  const prev = getInterviewHistory(memento);
  const next = [entry, ...prev].slice(0, MAX_HISTORY);
  await memento.update(INTERVIEW_HISTORY_KEY, next);
}

function plannedSlugSet(session: InterviewSessionState): Set<string> {
  return new Set(session.plannedProblems.map((p) => p.titleSlug));
}

function computeInterviewRewards(
  session: InterviewSessionState,
  solvedSlugs: string[]
): { total: number; breakdown: InterviewXpBreakdown } {
  const breakdown: InterviewXpBreakdown = {
    easyXp: 0,
    mediumXp: 0,
    hardXp: 0,
    unknownXp: 0,
    perfectBonusXp: 0,
  };
  if (solvedSlugs.length === 0) {
    return { total: 0, breakdown };
  }
  const slugToDifficulty = new Map(session.plannedProblems.map((p) => [p.titleSlug, p.difficulty]));
  const planned = plannedSlugSet(session);
  for (const slug of solvedSlugs) {
    if (!planned.has(slug)) continue;
    const diff = slugToDifficulty.get(slug) ?? "MEDIUM";
    const xp = xpForDifficultyLabel(diff);
    const u = diff.toUpperCase();
    if (u === "EASY") breakdown.easyXp += xp;
    else if (u === "MEDIUM") breakdown.mediumXp += xp;
    else if (u === "HARD") breakdown.hardXp += xp;
    else breakdown.unknownXp += xp;
  }
  const allPlannedSolved =
    session.plannedProblems.length > 0 &&
    session.plannedProblems.every((p) => solvedSlugs.includes(p.titleSlug));
  if (allPlannedSolved) {
    breakdown.perfectBonusXp = INTERVIEW_PERFECT_SET_BONUS;
  }
  const total =
    breakdown.easyXp +
    breakdown.mediumXp +
    breakdown.hardXp +
    breakdown.unknownXp +
    breakdown.perfectBonusXp;
  return { total, breakdown };
}

export type EndInterviewSessionResult = {
  entry: InterviewHistoryEntry;
  sourceLcInterviewPath?: string;
  interviewName: string;
  attemptHex?: string;
  solutionFolderPath?: string;
};

function defaultReportNameFromStartedAt(startedAt: number): string {
  const d = new Date(startedAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function endInterviewSession(
  memento: vscode.Memento,
  _reason: "user" | "timer"
): Promise<EndInterviewSessionResult | null> {
  const s = migrateRawSession(memento.get(INTERVIEW_SESSION_KEY));
  if (!s?.active) {
    await memento.update(INTERVIEW_SESSION_KEY, undefined);
    await setInterviewContext(false);
    return null;
  }
  const sourceLcInterviewPath = s.sourceLcInterviewPath;
  const interviewName = s.interviewName?.trim() || defaultReportNameFromStartedAt(s.startedAt);
  const endedAt = Date.now();
  const solvedSlugs = [...s.solvedDuringSession];
  const { total: bonusXp, breakdown } = computeInterviewRewards(s, solvedSlugs);
  await addBonusXp(memento, bonusXp);

  const plannedSlugs = s.plannedProblems.map((p) => p.titleSlug);
  const timeMap = s.interviewTimeBySlug ?? {};
  const solvedSet = new Set(solvedSlugs);
  const perProblem: InterviewPerProblemStat[] = s.plannedProblems.map((p) => {
    const slug = p.titleSlug;
    const solvedInInterview = solvedSet.has(slug);
    let interviewXpEarned = 0;
    if (solvedInInterview) {
      interviewXpEarned = xpForDifficultyLabel(p.difficulty);
    }
    return {
      titleSlug: slug,
      title: slug,
      secondsSpent: Math.max(0, Math.floor(timeMap[slug] ?? 0)),
      solvedInInterview,
      interviewXpEarned,
    };
  });
  const entry: InterviewHistoryEntry = {
    startedAt: s.startedAt,
    endedAt,
    durationMinutes: s.durationMinutes,
    plannedCount: plannedSlugs.length,
    solvedCount: solvedSlugs.length,
    bonusXp,
    plannedSlugs,
    solvedSlugs,
    plannedProblems: [...s.plannedProblems],
    xpBreakdown: { ...breakdown },
    perProblem,
  };
  await appendHistory(memento, entry);
  const outAttempt =
    typeof s.attemptHex === "string" && /^[0-9a-f]{3}$/.test(s.attemptHex.trim().toLowerCase())
      ? s.attemptHex.trim().toLowerCase()
      : undefined;
  const outFolder =
    typeof s.solutionFolderPath === "string" && s.solutionFolderPath.trim()
      ? path.resolve(s.solutionFolderPath.trim())
      : undefined;
  await memento.update(INTERVIEW_SESSION_KEY, undefined);
  await setInterviewContext(false);
  return {
    entry,
    ...(sourceLcInterviewPath ? { sourceLcInterviewPath } : {}),
    interviewName,
    ...(outAttempt ? { attemptHex: outAttempt } : {}),
    ...(outFolder ? { solutionFolderPath: outFolder } : {}),
  };
}

export function remainingMs(session: InterviewSessionState): number {
  return Math.max(0, session.endsAt - Date.now());
}

/** Minimal row for building an interview plan (e.g. from problemset). */
export interface InterviewPickSource {
  titleSlug: string;
  difficulty: string;
}

/**
 * Picks `count` problems with round-robin EASY → MEDIUM → HARD assignment.
 * Prefers unsolved per bucket; falls back to solved, then other tiers / full list.
 */
export function pickPlannedInterviewProblems(
  list: InterviewPickSource[],
  count: number,
  isSolved: (slug: string) => boolean
): PlannedInterviewProblem[] {
  if (count <= 0 || list.length === 0) return [];
  const order = ["EASY", "MEDIUM", "HARD"] as const;
  const byDiff: Record<(typeof order)[number], InterviewPickSource[]> = { EASY: [], MEDIUM: [], HARD: [] };
  for (const q of list) {
    const d = (q.difficulty || "").trim().toUpperCase();
    if (d === "EASY" || d === "MEDIUM" || d === "HARD") {
      byDiff[d].push(q);
    }
  }
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  for (const k of order) {
    byDiff[k] = shuffle(byDiff[k]);
  }
  const fullShuffled = shuffle([...list]);
  const picked = new Set<string>();
  const out: PlannedInterviewProblem[] = [];

  const takeFrom = (candidates: InterviewPickSource[], tier: string): PlannedInterviewProblem | null => {
    const free = candidates.filter((q) => !picked.has(q.titleSlug));
    const unsolved = free.filter((q) => !isSolved(q.titleSlug));
    const pool = unsolved.length > 0 ? unsolved : free;
    if (pool.length === 0) return null;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    picked.add(choice.titleSlug);
    return {
      titleSlug: choice.titleSlug,
      difficulty: (choice.difficulty || tier).toUpperCase(),
    };
  };

  for (let i = 0; i < count; i++) {
    const tier = order[i % 3];
    let p = takeFrom(byDiff[tier], tier);
    if (!p) {
      for (const other of order) {
        if (other === tier) continue;
        p = takeFrom(byDiff[other], other);
        if (p) break;
      }
    }
    if (!p) {
      const free = fullShuffled.filter((q) => !picked.has(q.titleSlug));
      const unsolved = free.filter((q) => !isSolved(q.titleSlug));
      const pool = unsolved.length > 0 ? unsolved : free;
      const choice = pool[0];
      if (!choice) break;
      picked.add(choice.titleSlug);
      p = {
        titleSlug: choice.titleSlug,
        difficulty: (choice.difficulty || "MEDIUM").toUpperCase(),
      };
    }
    out.push(p);
  }
  return out;
}
