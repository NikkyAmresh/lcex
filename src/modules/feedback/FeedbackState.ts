import type * as vscode from "vscode";

/**
 * Weekly feedback prompt: persisted state and the pure decision logic.
 *
 * Everything lives in one JSON object under {@link FEEDBACK_STATE_KEY}. The key
 * is intentionally NOT part of the cloud-synced allow-list, so a merge from
 * another machine can never resurrect or wrongly suppress the prompt.
 *
 * This module has no runtime dependency on `vscode` so it can be unit tested.
 */

export const FEEDBACK_STATE_KEY = "leetcode-practice.feedback.state";
/** Minimum gap between two prompts; also the snooze for "Later" or closing the toast. */
export const FEEDBACK_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Nobody is asked before they have been around this long. */
export const FEEDBACK_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const FEEDBACK_MIN_SOLVES = 1;
export const FEEDBACK_MIN_PRACTICE_SECONDS = 20 * 60;
/** Delay after activation before the first check, so the toast never lands on top of startup. */
export const FEEDBACK_PROMPT_DELAY_MS = 90_000;

export type FeedbackStatus = "pending" | "submitted" | "opted_out";
export type FeedbackSource = "prompt" | "command";
export type FeedbackPlatform = "darwin" | "linux" | "win32" | "other";

/** Exactly what is written to Firestore `feedback/{docId}`; also kept locally while unsent. */
export interface FeedbackDoc {
  docId: string;
  schemaVersion: 1;
  ts: number;
  installId: string;
  rating: number;
  comment: string;
  allowContact: boolean;
  email?: string;
  extVersion: string;
  vscodeVersion: string;
  platform: FeedbackPlatform;
  locale: string;
  source: FeedbackSource;
  promptCount: number;
  weekSolves: number;
  weekMinutes: number;
  level: number;
  totalSolved: number;
  streak: number;
}

export interface FeedbackState {
  v: 1;
  /** ms epoch; seeded from the earliest known activity so long-time users are eligible at once. */
  firstSeenAt: number;
  /** ms epoch; written BEFORE the toast is shown, so every dismissal path snoozes. */
  lastPromptedAt?: number;
  promptCount: number;
  status: FeedbackStatus;
  submittedAt?: number;
  optedOutAt?: number;
  /** One unsent payload, retried on the next activation. */
  pending?: FeedbackDoc;
}

export interface PromptGateInput {
  now: number;
  state: FeedbackState;
  settingEnabled: boolean;
  interviewActive: boolean;
  focusModeActive: boolean;
  panelOpen: boolean;
  totalSolved: number;
  totalPracticeSeconds: number;
}

export type PromptSkipReason =
  | "disabled"
  | "submitted"
  | "opted_out"
  | "interview"
  | "focus"
  | "panel_open"
  | "too_new"
  | "not_engaged"
  | "snoozed";

export type PromptDecision = { prompt: true } | { prompt: false; reason: PromptSkipReason };

const STATUSES: ReadonlySet<string> = new Set(["pending", "submitted", "opted_out"]);

function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function freshState(firstSeenAt: number): FeedbackState {
  return { v: 1, firstSeenAt, promptCount: 0, status: "pending" };
}

function isVersionedRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { v?: unknown }).v === 1;
}

/** Coerces whatever is on disk into a well-formed state. Never writes. */
function normalise(raw: unknown, now: number): FeedbackState {
  if (!isVersionedRecord(raw)) return freshState(now);
  const status =
    typeof raw.status === "string" && STATUSES.has(raw.status) ? (raw.status as FeedbackStatus) : "pending";
  const out: FeedbackState = {
    v: 1,
    firstSeenAt: finiteOrUndefined(raw.firstSeenAt) ?? now,
    promptCount: Math.max(0, Math.floor(finiteOrUndefined(raw.promptCount) ?? 0)),
    status,
  };
  const lastPromptedAt = finiteOrUndefined(raw.lastPromptedAt);
  if (lastPromptedAt !== undefined) out.lastPromptedAt = lastPromptedAt;
  const submittedAt = finiteOrUndefined(raw.submittedAt);
  if (submittedAt !== undefined) out.submittedAt = submittedAt;
  const optedOutAt = finiteOrUndefined(raw.optedOutAt);
  if (optedOutAt !== undefined) out.optedOutAt = optedOutAt;
  if (raw.pending && typeof raw.pending === "object" && !Array.isArray(raw.pending)) {
    out.pending = raw.pending as FeedbackDoc;
  }
  return out;
}

export function readFeedbackState(memento: vscode.Memento, now: number): FeedbackState {
  return normalise(memento.get<unknown>(FEEDBACK_STATE_KEY), now);
}

export async function writeFeedbackState(memento: vscode.Memento, state: FeedbackState): Promise<void> {
  await memento.update(FEEDBACK_STATE_KEY, state);
}

/**
 * Returns the stored state, creating it when missing. `seedFirstSeenAt` (the
 * earliest known activity) lets existing users skip the three-day wait.
 */
export async function ensureFeedbackState(
  memento: vscode.Memento,
  now: number,
  seedFirstSeenAt?: number
): Promise<FeedbackState> {
  const raw = memento.get<unknown>(FEEDBACK_STATE_KEY);
  if (isVersionedRecord(raw)) return normalise(raw, now);
  const seed = finiteOrUndefined(seedFirstSeenAt);
  const state = freshState(seed !== undefined && seed > 0 ? Math.min(now, seed) : now);
  await writeFeedbackState(memento, state);
  return state;
}

export async function markPrompted(memento: vscode.Memento, now: number): Promise<FeedbackState> {
  const s = readFeedbackState(memento, now);
  const next: FeedbackState = { ...s, lastPromptedAt: now, promptCount: s.promptCount + 1 };
  await writeFeedbackState(memento, next);
  return next;
}

export async function markOptedOut(memento: vscode.Memento, now: number): Promise<FeedbackState> {
  const s = readFeedbackState(memento, now);
  const next: FeedbackState = { ...s, status: "opted_out", optedOutAt: now };
  await writeFeedbackState(memento, next);
  return next;
}

export async function markSubmitted(
  memento: vscode.Memento,
  now: number,
  pending: FeedbackDoc
): Promise<FeedbackState> {
  const s = readFeedbackState(memento, now);
  const next: FeedbackState = { ...s, status: "submitted", submittedAt: now, pending };
  await writeFeedbackState(memento, next);
  return next;
}

export async function clearPendingFeedback(
  memento: vscode.Memento,
  now: number = Date.now()
): Promise<FeedbackState> {
  const next: FeedbackState = { ...readFeedbackState(memento, now) };
  delete next.pending;
  await writeFeedbackState(memento, next);
  return next;
}

/** Development helper: forget everything so the prompt can be exercised again. */
export async function resetFeedbackState(memento: vscode.Memento): Promise<void> {
  await memento.update(FEEDBACK_STATE_KEY, undefined);
}

/** Pure gate. Evaluated top to bottom; the first matching row wins. */
export function shouldPromptFeedback(i: PromptGateInput): PromptDecision {
  if (!i.settingEnabled) return { prompt: false, reason: "disabled" };
  if (i.state.status === "submitted") return { prompt: false, reason: "submitted" };
  if (i.state.status === "opted_out") return { prompt: false, reason: "opted_out" };
  if (i.interviewActive) return { prompt: false, reason: "interview" };
  if (i.focusModeActive) return { prompt: false, reason: "focus" };
  if (i.panelOpen) return { prompt: false, reason: "panel_open" };
  if (i.now - i.state.firstSeenAt < FEEDBACK_MIN_AGE_MS) return { prompt: false, reason: "too_new" };
  if (i.totalSolved < FEEDBACK_MIN_SOLVES && i.totalPracticeSeconds < FEEDBACK_MIN_PRACTICE_SECONDS) {
    return { prompt: false, reason: "not_engaged" };
  }
  if (i.state.lastPromptedAt !== undefined && i.now - i.state.lastPromptedAt < FEEDBACK_PROMPT_INTERVAL_MS) {
    return { prompt: false, reason: "snoozed" };
  }
  return { prompt: true };
}
