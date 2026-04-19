import * as vscode from "vscode";
import {
  ATTEMPT_XP_BLOCKS_PAID_KEY,
  DAILY_GOAL_KEY,
  LAST_DAILY_LOGIN_XP_DATE_KEY,
  PRACTICE_SECONDS_TOTAL_KEY,
  TOTAL_XP_KEY,
  XP_GRANTED_SLUGS_KEY,
} from "../Gamification";
import { INTERVIEW_HISTORY_KEY } from "../InterviewMode";
import * as Logger from "../Logger";
import { TIMER_BY_DAY_KEY, TIMER_ELAPSED_KEY } from "../ProblemTimer";
import {
  FIREBASE_CONFIG,
  getCloudIdentity,
  getFreshIdToken,
} from "./firebaseApp";

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

const LEETCODE_USERNAME_SETTING = "leetcodeUsername";

export interface CloudStatsDocument {
  schemaVersion: number;
  leetcodeUsername: string;
  uid: string;
  updatedAt: number;
  /** Memento key → JSON-serializable value */
  data: Record<string, unknown>;
}

export function getConfiguredLeetcodeUsername(): string {
  return (
    vscode.workspace.getConfiguration("leetcodePractice").get<string>(LEETCODE_USERNAME_SETTING)?.trim() ??
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

// --------------------------------------------------------------------------
// Firestore REST encoding (avoids the heavy firebase JS SDK).
// Docs: https://firebase.google.com/docs/firestore/reference/rest/v1/Value
// --------------------------------------------------------------------------

type FsValue = Record<string, unknown>;

function jsToFsValue(v: unknown): FsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(jsToFsValue) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: jsToFsFields(v as Record<string, unknown>) } };
  }
  return { stringValue: String(v) };
}

function jsToFsFields(o: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = jsToFsValue(v);
  }
  return out;
}

function fsValueToJs(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) {
    const av = v.arrayValue as { values?: FsValue[] };
    return (av.values ?? []).map(fsValueToJs);
  }
  if ("mapValue" in v) {
    const mv = v.mapValue as { fields?: Record<string, FsValue> };
    return fsFieldsToJs(mv.fields ?? {});
  }
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}

function fsFieldsToJs(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fsValueToJs(v);
  }
  return out;
}

function statsDocPath(uid: string, username: string): string {
  return `users/${encodeURIComponent(uid)}/stats/${encodeURIComponent(username)}`;
}

function statsDocUrl(uid: string, username: string): string {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${statsDocPath(uid, username)}`;
}

// --------------------------------------------------------------------------

export async function fetchCloudStatsDocument(
  context: vscode.ExtensionContext,
  username: string
): Promise<CloudStatsDocument | null> {
  const id = sanitizeCloudUsername(username);
  if (!id) return null;
  const identity = getCloudIdentity(context.globalState);
  if (!identity) return null;
  const idToken = await getFreshIdToken(context);
  if (!idToken) return null;

  const url = statsDocUrl(identity.uid, id);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    Logger.logError(`fetchCloudStats failed: ${res.status}`, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { fields?: Record<string, FsValue> };
  if (!json.fields) return null;
  const flat = fsFieldsToJs(json.fields);
  const schemaVersion = flat.schemaVersion;
  const updatedAt = flat.updatedAt;
  const data = flat.data;
  if (typeof schemaVersion !== "number" || schemaVersion < 1) return null;
  if (typeof updatedAt !== "number") return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    schemaVersion,
    leetcodeUsername: id,
    uid: identity.uid,
    updatedAt,
    data: data as Record<string, unknown>,
  };
}

export type PushStatsResult =
  | { ok: true }
  | { ok: false; reason: "not_signed_in" | "no_username" | "invalid_username" | "throttled"; nextAllowedAt?: number }
  | { ok: false; reason: "firestore"; message: string };

/**
 * Writes local snapshot to Firestore at users/<uid>/stats/<username>.
 * Respects 10-minute throttle via `CLOUD_STATS_LAST_PUSH_KEY`.
 */
export async function pushStatsToCloud(
  context: vscode.ExtensionContext,
  globalState: vscode.Memento
): Promise<PushStatsResult> {
  const identity = getCloudIdentity(globalState);
  if (!identity) return { ok: false, reason: "not_signed_in" };

  const raw = getConfiguredLeetcodeUsername();
  if (!raw) return { ok: false, reason: "no_username" };
  const username = sanitizeCloudUsername(raw);
  if (!username) return { ok: false, reason: "invalid_username" };

  const throttle = canPushNow(globalState);
  if (!throttle.allowed) {
    return { ok: false, reason: "throttled", nextAllowedAt: throttle.nextAllowedAt };
  }

  const idToken = await getFreshIdToken(context);
  if (!idToken) return { ok: false, reason: "not_signed_in" };

  const payload: CloudStatsDocument = {
    schemaVersion: CLOUD_STATS_SCHEMA_VERSION,
    leetcodeUsername: username,
    uid: identity.uid,
    updatedAt: Date.now(),
    data: serializeSnapshotData(globalState),
  };

  const body = {
    fields: jsToFsFields({
      schemaVersion: payload.schemaVersion,
      leetcodeUsername: payload.leetcodeUsername,
      uid: payload.uid,
      updatedAt: payload.updatedAt,
      data: payload.data,
    }),
  };

  const url = statsDocUrl(identity.uid, username);
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, reason: "firestore", message: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    await globalState.update(CLOUD_STATS_LAST_PUSH_KEY, Date.now());
    Logger.log(`Cloud stats pushed for uid=${identity.uid} username=${username}`);
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
