import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import * as vscode from "vscode";
import * as Database from "../Database";
import {
  ATTEMPT_XP_BLOCKS_PAID_KEY,
  DAILY_GOAL_KEY,
  LAST_DAILY_LOGIN_XP_DATE_KEY,
  PRACTICE_SECONDS_TOTAL_KEY,
  TOTAL_XP_KEY,
  XP_GRANTED_SLUGS_KEY,
} from "../Gamification";
import { INTERVIEW_HISTORY_KEY } from "../InterviewMode";
import { LeetCodeProvider } from "../LeetCode";
import * as Logger from "../Logger";
import { TIMER_BY_DAY_KEY, TIMER_ELAPSED_KEY } from "../ProblemTimer";
import { getFirestoreDb } from "./firebaseApp";

export const CLOUD_STATS_COLLECTION = "leetcodeStats";

/** v1 snapshot: problem status, timers, XP, goals, interview history, notes. */
export const CLOUD_STATS_SCHEMA_VERSION = 1;

export const CLOUD_STATS_LAST_PUSH_KEY = "leetcode-practice.cloudStatsLastPushAt";

const PRACTICE_SECONDS_MIGRATION_KEY = "leetcode-practice.practiceSecondsFromTimerByDayMigrated_v1";

const STATUS_KEY = "leetcode-practice.problemStatus";
const NOTES_KEY = "leetcode-practice.problemNotes";

/** Keys merged on pull; must match serialized shape in `serializeSnapshotData`. */
export const CLOUD_SYNC_KEYS: readonly string[] = [
  STATUS_KEY,
  TIMER_BY_DAY_KEY,
  TIMER_ELAPSED_KEY,
  TOTAL_XP_KEY,
  XP_GRANTED_SLUGS_KEY,
  DAILY_GOAL_KEY,
  LAST_DAILY_LOGIN_XP_DATE_KEY,
  PRACTICE_SECONDS_TOTAL_KEY,
  ATTEMPT_XP_BLOCKS_PAID_KEY,
  PRACTICE_SECONDS_MIGRATION_KEY,
  INTERVIEW_HISTORY_KEY,
  NOTES_KEY,
];

const SYNC_KEY_SET = new Set(CLOUD_SYNC_KEYS);

export const PUSH_INTERVAL_MS = 10 * 60 * 1000;

export interface CloudStatsDocument {
  schemaVersion: number;
  leetcodeUsername: string;
  updatedAt: number;
  /** Memento key → JSON-serializable value */
  data: Record<string, unknown>;
}

export function getConfiguredLeetcodeUsername(): string {
  return (
    vscode.workspace.getConfiguration("leetcodePractice").get<string>("leetcodeUsername")?.trim() ??
    ""
  );
}

/** Firestore document id: alphanumeric, underscore, hyphen, dot; 1–128 chars. */
export function sanitizeCloudUsername(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 1 || t.length > 128) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(t)) return null;
  return t;
}

export function serializeSnapshotData(memento: vscode.Memento): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CLOUD_SYNC_KEYS) {
    const v = memento.get(key);
    if (v !== undefined) {
      out[key] = v as unknown;
    }
  }
  return out;
}

function parseCloudDoc(raw: Record<string, unknown>): CloudStatsDocument | null {
  const schemaVersion = raw.schemaVersion;
  const leetcodeUsername = raw.leetcodeUsername;
  const updatedAt = raw.updatedAt;
  const data = raw.data;
  if (typeof schemaVersion !== "number" || schemaVersion < 1) return null;
  if (typeof leetcodeUsername !== "string" || !leetcodeUsername.trim()) return null;
  if (typeof updatedAt !== "number") return null;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    schemaVersion,
    leetcodeUsername: leetcodeUsername.trim(),
    updatedAt,
    data: data as Record<string, unknown>,
  };
}

export async function fetchCloudStatsDocument(
  username: string
): Promise<CloudStatsDocument | null> {
  const id = sanitizeCloudUsername(username);
  if (!id) return null;
  const db = getFirestoreDb();
  const ref = doc(db, CLOUD_STATS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const parsed = parseCloudDoc(snap.data() as Record<string, unknown>);
  return parsed;
}

export function canPushNow(memento: vscode.Memento): { allowed: boolean; nextAllowedAt?: number } {
  const last = memento.get<number>(CLOUD_STATS_LAST_PUSH_KEY);
  if (last == null || typeof last !== "number" || !Number.isFinite(last)) {
    return { allowed: true };
  }
  const elapsed = Date.now() - last;
  if (elapsed >= PUSH_INTERVAL_MS) return { allowed: true };
  return { allowed: false, nextAllowedAt: last + PUSH_INTERVAL_MS };
}

export function formatPushWaitMessage(nextAllowedAt: number): string {
  const sec = Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `Next push allowed in ${m}m ${s}s.`;
}

async function warnIfUsernameMismatch(
  context: vscode.ExtensionContext,
  configuredUsername: string
): Promise<void> {
  const session = Database.getSession(context);
  if (!session?.cookie?.trim()) return;
  try {
    const profile = await new LeetCodeProvider().getUserProfileAndStats(session.cookie);
    if (!profile) return;
    if (configuredUsername.toLowerCase() !== profile.username.toLowerCase()) {
      void vscode.window.showWarningMessage(
        `Cloud username "${configuredUsername}" differs from signed-in LeetCode account "${profile.username}". Stats are stored under the cloud username.`
      );
    }
  } catch {
    // ignore
  }
}

export type PushStatsResult =
  | { ok: true }
  | { ok: false; reason: "no_username" | "invalid_username" | "throttled"; nextAllowedAt?: number }
  | { ok: false; reason: "firestore"; message: string };

/**
 * Writes local snapshot to Firestore. Respects 10-minute throttle via `CLOUD_STATS_LAST_PUSH_KEY`.
 */
export async function pushStatsToCloud(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento
): Promise<PushStatsResult> {
  const raw = getConfiguredLeetcodeUsername();
  const username = sanitizeCloudUsername(raw);
  if (!raw) {
    return { ok: false, reason: "no_username" };
  }
  if (!username) {
    return { ok: false, reason: "invalid_username" };
  }

  const throttle = canPushNow(globalState);
  if (!throttle.allowed) {
    return {
      ok: false,
      reason: "throttled",
      nextAllowedAt: throttle.nextAllowedAt,
    };
  }

  void warnIfUsernameMismatch(context, username);

  const payload: CloudStatsDocument = {
    schemaVersion: CLOUD_STATS_SCHEMA_VERSION,
    leetcodeUsername: username,
    updatedAt: Date.now(),
    data: serializeSnapshotData(globalState),
  };

  try {
    const db = getFirestoreDb();
    const ref = doc(db, CLOUD_STATS_COLLECTION, username);
    await setDoc(
      ref,
      {
        schemaVersion: payload.schemaVersion,
        leetcodeUsername: payload.leetcodeUsername,
        updatedAt: payload.updatedAt,
        data: payload.data,
      },
      { merge: true }
    );
    await globalState.update(CLOUD_STATS_LAST_PUSH_KEY, Date.now());
    Logger.log(`Cloud stats pushed for ${username}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    Logger.logError("pushStatsToCloud failed", e);
    return { ok: false, reason: "firestore", message };
  }
}

/** Overwrites synced keys from the cloud document. Does not clear keys missing from `doc.data`. */
export async function applyCloudStatsMerge(
  globalState: vscode.Memento,
  doc: CloudStatsDocument
): Promise<void> {
  for (const [key, value] of Object.entries(doc.data)) {
    if (!SYNC_KEY_SET.has(key)) continue;
    await globalState.update(key, value);
  }
}
