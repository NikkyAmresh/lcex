import { computeStreak, xpLevelProgress } from "../Gamification";
import type { StoredStatusEntry } from "../ProblemsProvider";

/**
 * Turns the user's local activity into the numbers and sentences the feedback
 * prompt uses, so the ask is about their week rather than a generic "rate us".
 *
 * Pure: no `vscode` import, plain inputs, unit tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface FeedbackStatsInput {
  /** UTC "YYYY-MM-DD", as produced by `todayIso()`. */
  today: string;
  statusEntries: Record<string, StoredStatusEntry>;
  timerByDay: Record<string, Record<string, number>>;
  practiceSecondsTotal: number | undefined;
  totalXp: number;
  interviewEndedAts: number[];
  nowMs: number;
  leetcodeUsername: string;
  cloudEmail: string | null;
}

export interface FeedbackStats {
  displayName?: string;
  weekSolves: number;
  weekMinutes: number;
  weekInterviews: number;
  hasWeekActivity: boolean;
  level: number;
  totalSolved: number;
  streak: number;
  totalPracticeSeconds: number;
  /** ms epoch of the earliest solve or practice day; seeds `firstSeenAt`. */
  earliestActivityMs?: number;
}

export interface FeedbackTile {
  label: string;
  value: string;
}

export interface FeedbackCopy {
  /** The toast text, one personal clause plus the call to action. */
  notification: string;
  /** Page heading. */
  headline: string;
  /** Page sub line: the personal clause without the call to action. */
  summary: string;
  tiles: FeedbackTile[];
}

const HEADLINE = "How is lcex going for you?";
const CTA = "Got 30 seconds to tell us how it's going?";

/** The `n` ISO days ending on `today`, oldest first. */
export function lastNDays(today: string, n: number): string[] {
  const base = new Date(today + "T12:00:00Z");
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function nameFrom(source: string): string | undefined {
  const local = source.split("@")[0] ?? "";
  const token = local.split(/[._\-\d]+/).find((t) => t.replace(/[^A-Za-z]/g, "").length >= 2);
  if (!token) return undefined;
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return undefined;
  return (letters[0].toUpperCase() + letters.slice(1).toLowerCase()).slice(0, 20);
}

/** A first name to address the user by, or nothing rather than something awkward. */
export function friendlyName(leetcodeUsername: string, cloudEmail: string | null): string | undefined {
  const fromEmail = cloudEmail ? nameFrom(cloudEmail) : undefined;
  if (fromEmail) return fromEmail;
  return leetcodeUsername ? nameFrom(leetcodeUsername) : undefined;
}

/** 192 gives "3h 12m", 60 gives "1h", 45 gives "45m", 0 gives "". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m === 0) return "";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function isoDayToMs(day: string): number | undefined {
  if (!ISO_DAY.test(day)) return undefined;
  const t = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(t) ? t : undefined;
}

export function computeFeedbackStats(i: FeedbackStatsInput): FeedbackStats {
  const week = new Set(lastNDays(i.today, 7));

  let weekSolves = 0;
  let totalSolved = 0;
  let earliest: number | undefined;
  for (const e of Object.values(i.statusEntries)) {
    if (!e || e.status !== "solved") continue;
    totalSolved += 1;
    if (!e.solvedAt) continue;
    if (week.has(e.solvedAt)) weekSolves += 1;
    const ms = isoDayToMs(e.solvedAt);
    if (ms !== undefined && (earliest === undefined || ms < earliest)) earliest = ms;
  }

  let weekSeconds = 0;
  let allSeconds = 0;
  for (const [day, bySlug] of Object.entries(i.timerByDay ?? {})) {
    if (!bySlug || typeof bySlug !== "object") continue;
    let daySeconds = 0;
    for (const v of Object.values(bySlug)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) daySeconds += v;
    }
    if (daySeconds === 0) continue;
    allSeconds += daySeconds;
    if (week.has(day)) weekSeconds += daySeconds;
    const ms = isoDayToMs(day);
    if (ms !== undefined && (earliest === undefined || ms < earliest)) earliest = ms;
  }
  const weekMinutes = Math.round(weekSeconds / 60);

  const stored = i.practiceSecondsTotal;
  const totalPracticeSeconds = Math.max(
    typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : 0,
    allSeconds
  );

  const weekInterviews = i.interviewEndedAts.filter(
    (t) => typeof t === "number" && t <= i.nowMs && i.nowMs - t <= 7 * DAY_MS
  ).length;

  const stats: FeedbackStats = {
    weekSolves,
    weekMinutes,
    weekInterviews,
    hasWeekActivity: weekSolves > 0 || weekMinutes >= 1,
    level: xpLevelProgress(i.totalXp).level,
    totalSolved,
    streak: computeStreak(i.statusEntries, i.today),
    totalPracticeSeconds,
  };
  const displayName = friendlyName(i.leetcodeUsername, i.cloudEmail);
  if (displayName) stats.displayName = displayName;
  if (earliest !== undefined) stats.earliestActivityMs = earliest;
  return stats;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function composeFeedbackCopy(s: FeedbackStats): FeedbackCopy {
  const name = s.displayName;
  const lead = name ? `${name}, ` : "";
  const dayWord = s.streak === 1 ? "day" : "days";

  if (s.hasWeekActivity) {
    const parts: string[] = [];
    if (s.weekSolves > 0) parts.push(plural(s.weekSolves, "solve", "solves"));
    if (s.weekMinutes >= 1) parts.push(`${formatMinutes(s.weekMinutes)} of practice`);
    const body = parts.join(" and ");
    return {
      notification: `${lead}${body} with lcex this week. ${CTA}`,
      headline: HEADLINE,
      summary: `${lead}${body} in the last 7 days.`,
      tiles: [
        { label: "Solved this week", value: String(s.weekSolves) },
        { label: "Practice this week", value: formatMinutes(s.weekMinutes) || "0m" },
        { label: "Level", value: String(s.level) },
        { label: "Streak", value: `${s.streak} ${dayWord}` },
      ],
    };
  }

  if (s.totalSolved > 0 || s.level > 1 || s.streak > 0) {
    const solved = plural(s.totalSolved, "problem", "problems") + " solved";
    const streak = s.streak > 0 ? ` and a ${s.streak}-day streak` : "";
    const tiles: FeedbackTile[] = [
      { label: "Level", value: String(s.level) },
      { label: "Solved so far", value: String(s.totalSolved) },
      { label: "Streak", value: `${s.streak} ${dayWord}` },
    ];
    const practice = formatMinutes(s.totalPracticeSeconds / 60);
    if (practice) tiles.push({ label: "Practice so far", value: practice });
    return name
      ? {
          notification: `${name}, you are level ${s.level} with ${solved}${streak} in lcex. ${CTA}`,
          headline: HEADLINE,
          summary: `${name}, you are level ${s.level} with ${solved}${streak}.`,
          tiles,
        }
      : {
          notification: `Level ${s.level}, ${solved}${streak} in lcex so far. ${CTA}`,
          headline: HEADLINE,
          summary: `Level ${s.level}, ${solved}${streak} so far.`,
          tiles,
        };
  }

  const practice = formatMinutes(s.totalPracticeSeconds / 60);
  if (practice) {
    return {
      notification: `${lead}${practice} of practice with lcex so far. ${CTA}`,
      headline: HEADLINE,
      summary: `${lead}${practice} of practice so far.`,
      tiles: [{ label: "Practice so far", value: practice }],
    };
  }

  return {
    notification: HEADLINE,
    headline: HEADLINE,
    summary: name ? `${name}, tell us what you think of lcex so far.` : "Tell us what you think of lcex so far.",
    tiles: [],
  };
}
