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

/** Workspace: saved `zenMode.hideStatusBar` while focus mode is active; key present ⇒ workbench focus mode on. */
export const FOCUS_ZEN_STATUSBAR_PREV_KEY = "leetcode-practice.focusZenHideStatusBarPrev";

/** Last language chosen in the problem webview (Solve / dropdown); not per-problem. */
export const LAST_CHALLENGE_PANEL_LANGUAGE_KEY = "leetcode-practice.lastChallengePanelLanguage";

/** Participation XP when exiting focus mode (at most once per cooldown). */
export const FOCUS_SESSION_PARTICIPATION_XP = 10;
export const FOCUS_SESSION_XP_COOLDOWN_MS = 60 * 60 * 1000;
export const FOCUS_LAST_PARTICIPATION_XP_AT_KEY = "leetcode-practice.focusLastParticipationXpAt";

/** Once per calendar day (UTC) when the extension activates. */
export const DAILY_LOGIN_XP = 1;
export const LAST_DAILY_LOGIN_XP_DATE_KEY = "leetcode-practice.lastDailyLoginXpDate";

/** +5 XP per full 30 minutes of problem-timer practice (any problems; cumulative). */
export const ATTEMPT_BLOCK_MINUTES = 30;
export const ATTEMPT_BLOCK_XP = 5;
export const PRACTICE_SECONDS_TOTAL_KEY = "leetcode-practice.practiceSecondsTotalForAttemptXp";
export const ATTEMPT_XP_BLOCKS_PAID_KEY = "leetcode-practice.attemptXpBlocksPaid";
const PRACTICE_SECONDS_FROM_TIMER_MIGRATED_KEY = "leetcode-practice.practiceSecondsFromTimerByDayMigrated_v1";
/** Must match `TIMER_BY_DAY_KEY` in ProblemTimer.ts (avoid circular import). */
const TIMER_BY_DAY_KEY_FOR_MIGRATION = "leetcode-practice.timerByDay";

/** XP for interview bonus / first-solve (same curve). */
export function xpForDifficultyLabel(difficultyRaw: string | undefined): number {
  if (!difficultyRaw) return 15;
  const u = difficultyRaw.trim().toUpperCase();
  if (u === "EASY") return 10;
  if (u === "MEDIUM") return 20;
  if (u === "HARD") return 40;
  return 15;
}

function difficultyXp(difficultyRaw: string | undefined): number {
  return xpForDifficultyLabel(difficultyRaw);
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

/**
 * Awards +{@link DAILY_LOGIN_XP} once per UTC calendar day on first call that day.
 * @returns XP granted (0 if already granted today)
 */
export async function grantDailyLoginXpIfNeeded(memento: vscode.Memento): Promise<number> {
  const today = todayIso();
  const last = memento.get<string>(LAST_DAILY_LOGIN_XP_DATE_KEY);
  if (last === today) return 0;
  await addBonusXp(memento, DAILY_LOGIN_XP);
  await memento.update(LAST_DAILY_LOGIN_XP_DATE_KEY, today);
  return DAILY_LOGIN_XP;
}

async function migratePracticeSecondsBaselineFromTimerByDay(memento: vscode.Memento): Promise<void> {
  if (memento.get<boolean>(PRACTICE_SECONDS_FROM_TIMER_MIGRATED_KEY)) return;
  const byDay = memento.get<Record<string, Record<string, number>>>(TIMER_BY_DAY_KEY_FOR_MIGRATION) ?? {};
  let sum = 0;
  for (const day of Object.values(byDay)) {
    for (const v of Object.values(day)) {
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
    }
  }
  const blockSec = ATTEMPT_BLOCK_MINUTES * 60;
  const blocksAlready = Math.floor(sum / blockSec);
  await memento.update(PRACTICE_SECONDS_TOTAL_KEY, sum);
  await memento.update(ATTEMPT_XP_BLOCKS_PAID_KEY, blocksAlready);
  await memento.update(PRACTICE_SECONDS_FROM_TIMER_MIGRATED_KEY, true);
}

/**
 * Call once per active problem-timer second. Grants {@link ATTEMPT_BLOCK_XP} XP for each new full
 * {@link ATTEMPT_BLOCK_MINUTES}-minute block of cumulative practice (all slugs).
 * @returns XP granted this call (0 most of the time)
 */
export async function recordPracticeSecondForAttemptXp(memento: vscode.Memento): Promise<number> {
  await migratePracticeSecondsBaselineFromTimerByDay(memento);
  const prev = memento.get<number>(PRACTICE_SECONDS_TOTAL_KEY);
  const base = typeof prev === "number" && Number.isFinite(prev) ? prev : 0;
  const total = base + 1;
  await memento.update(PRACTICE_SECONDS_TOTAL_KEY, total);
  const blockSec = ATTEMPT_BLOCK_MINUTES * 60;
  const eligibleBlocks = Math.floor(total / blockSec);
  const paid = memento.get<number>(ATTEMPT_XP_BLOCKS_PAID_KEY) ?? 0;
  if (eligibleBlocks <= paid) return 0;
  const newBlocks = eligibleBlocks - paid;
  const xp = newBlocks * ATTEMPT_BLOCK_XP;
  await addBonusXp(memento, xp);
  await memento.update(ATTEMPT_XP_BLOCKS_PAID_KEY, eligibleBlocks);
  return xp;
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
