import * as vscode from "vscode";

/** Total XP ever earned (local). */
export const TOTAL_XP_KEY = "leetcode-practice.totalXp";
/** Slugs that have already granted first-solve XP. */
export const XP_GRANTED_SLUGS_KEY = "leetcode-practice.xpGrantedSlugs";

export type DailyGoalMode = "problems" | "minutes";

export interface DailyGoal {
  mode: DailyGoalMode;
  target: number;
}

export const DAILY_GOAL_KEY = "leetcode-practice.dailyGoal";

/** Webview compact chrome (problem panel). */
export const FOCUS_COMPACT_WEBVIEW_KEY = "leetcode-practice.focusCompactWebview";

function difficultyXp(difficultyRaw: string | undefined): number {
  if (!difficultyRaw) return 15;
  const u = difficultyRaw.trim().toUpperCase();
  if (u === "EASY") return 10;
  if (u === "MEDIUM") return 20;
  if (u === "HARD") return 40;
  return 15;
}

/** Level 1 at 0 XP. Reaching level L+1 costs 100 * L XP (100 to reach 2, +200 to reach 3, …). */
export function xpLevelProgress(totalXp: number): {
  level: number;
  xpInLevel: number;
  xpNeededForNext: number;
} {
  let level = 1;
  let xp = Math.max(0, totalXp);
  let need = 100;
  while (xp >= need) {
    xp -= need;
    level += 1;
    need = 100 * level;
  }
  return { level, xpInLevel: xp, xpNeededForNext: need };
}

export function getTotalXp(memento: vscode.Memento): number {
  const n = memento.get<number>(TOTAL_XP_KEY);
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function getDailyGoal(memento: vscode.Memento): DailyGoal | undefined {
  const g = memento.get<DailyGoal>(DAILY_GOAL_KEY);
  if (!g || (g.mode !== "problems" && g.mode !== "minutes")) return undefined;
  if (typeof g.target !== "number" || g.target <= 0) return undefined;
  return g;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function countSolvedToday(
  entries: Record<string, { status: string; solvedAt?: string }>,
  day: string
): number {
  let n = 0;
  for (const e of Object.values(entries)) {
    if (e.status === "solved" && e.solvedAt === day) n += 1;
  }
  return n;
}

export function sumTimerMinutesToday(timerByDay: Record<string, Record<string, number>>, day: string): number {
  const dayMap = timerByDay[day];
  if (!dayMap) return 0;
  let sec = 0;
  for (const v of Object.values(dayMap)) {
    if (typeof v === "number" && Number.isFinite(v)) sec += v;
  }
  return Math.round(sec / 60);
}

/**
 * First-solve XP only (per slug, forever). Returns XP gained (0 if already granted).
 */
export async function awardXpForFirstSolve(
  memento: vscode.Memento,
  titleSlug: string,
  difficultyRaw: string | undefined
): Promise<number> {
  const granted = memento.get<Record<string, boolean>>(XP_GRANTED_SLUGS_KEY) ?? {};
  if (granted[titleSlug]) return 0;
  const add = difficultyXp(difficultyRaw);
  const prev = getTotalXp(memento);
  await memento.update(TOTAL_XP_KEY, prev + add);
  await memento.update(XP_GRANTED_SLUGS_KEY, { ...granted, [titleSlug]: true });
  return add;
}

export async function addBonusXp(memento: vscode.Memento, amount: number): Promise<void> {
  if (amount <= 0) return;
  const prev = getTotalXp(memento);
  await memento.update(TOTAL_XP_KEY, prev + amount);
}

export async function setDailyGoal(memento: vscode.Memento, goal: DailyGoal | undefined): Promise<void> {
  if (!goal) {
    await memento.update(DAILY_GOAL_KEY, undefined);
    return;
  }
  await memento.update(DAILY_GOAL_KEY, goal);
}

export function dailyGoalProgressPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}
