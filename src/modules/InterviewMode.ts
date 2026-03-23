import * as vscode from "vscode";
import { addBonusXp } from "./Gamification";

export const INTERVIEW_SESSION_KEY = "leetcode-practice.interviewSession";
export const INTERVIEW_HISTORY_KEY = "leetcode-practice.interviewHistory";

export const INTERVIEW_MODE_CONTEXT = "leetcodePractice.interviewMode";

export interface InterviewSessionState {
  active: boolean;
  startedAt: number;
  endsAt: number;
  plannedSlugs: string[];
  solvedDuringSession: string[];
  durationMinutes: number;
}

export interface InterviewHistoryEntry {
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  plannedCount: number;
  solvedCount: number;
  bonusXp: number;
  plannedSlugs: string[];
  solvedSlugs: string[];
}

const MAX_HISTORY = 50;
const BONUS_PER_SOLVED = 15;
const SESSION_COMPLETE_BONUS = 25;

export function getInterviewSession(memento: vscode.Memento): InterviewSessionState | undefined {
  const s = memento.get<InterviewSessionState>(INTERVIEW_SESSION_KEY);
  if (!s || !s.active) return undefined;
  if (typeof s.endsAt !== "number" || typeof s.startedAt !== "number") return undefined;
  return s;
}

export function getInterviewHistory(memento: vscode.Memento): InterviewHistoryEntry[] {
  const h = memento.get<InterviewHistoryEntry[]>(INTERVIEW_HISTORY_KEY);
  return Array.isArray(h) ? h : [];
}

export async function setInterviewContext(active: boolean): Promise<void> {
  await vscode.commands.executeCommand("setContext", INTERVIEW_MODE_CONTEXT, active);
}

export async function startInterviewSession(
  memento: vscode.Memento,
  durationMinutes: 45 | 60 | 180,
  plannedSlugs: string[]
): Promise<void> {
  const now = Date.now();
  const state: InterviewSessionState = {
    active: true,
    startedAt: now,
    endsAt: now + durationMinutes * 60_000,
    plannedSlugs: [...new Set(plannedSlugs.map((s) => s.trim()).filter(Boolean))],
    solvedDuringSession: [],
    durationMinutes,
  };
  await memento.update(INTERVIEW_SESSION_KEY, state);
  await setInterviewContext(true);
}

export async function recordInterviewSolve(memento: vscode.Memento, titleSlug: string): Promise<void> {
  const s = memento.get<InterviewSessionState>(INTERVIEW_SESSION_KEY);
  if (!s?.active) return;
  if (s.solvedDuringSession.includes(titleSlug)) return;
  const next: InterviewSessionState = {
    ...s,
    solvedDuringSession: [...s.solvedDuringSession, titleSlug],
  };
  await memento.update(INTERVIEW_SESSION_KEY, next);
}

async function appendHistory(memento: vscode.Memento, entry: InterviewHistoryEntry): Promise<void> {
  const prev = getInterviewHistory(memento);
  const next = [entry, ...prev].slice(0, MAX_HISTORY);
  await memento.update(INTERVIEW_HISTORY_KEY, next);
}

export async function endInterviewSession(
  memento: vscode.Memento,
  reason: "user" | "timer"
): Promise<InterviewHistoryEntry | null> {
  const s = memento.get<InterviewSessionState>(INTERVIEW_SESSION_KEY);
  if (!s?.active) {
    await memento.update(INTERVIEW_SESSION_KEY, undefined);
    await setInterviewContext(false);
    return null;
  }
  const endedAt = Date.now();
  const solvedSlugs = [...s.solvedDuringSession];
  const bonusXp = SESSION_COMPLETE_BONUS + solvedSlugs.length * BONUS_PER_SOLVED;
  await addBonusXp(memento, bonusXp);

  const entry: InterviewHistoryEntry = {
    startedAt: s.startedAt,
    endedAt,
    durationMinutes: s.durationMinutes,
    plannedCount: s.plannedSlugs.length,
    solvedCount: solvedSlugs.length,
    bonusXp,
    plannedSlugs: s.plannedSlugs,
    solvedSlugs,
  };
  await appendHistory(memento, entry);
  await memento.update(INTERVIEW_SESSION_KEY, undefined);
  await setInterviewContext(false);
  return entry;
}

export function remainingMs(session: InterviewSessionState): number {
  return Math.max(0, session.endsAt - Date.now());
}
