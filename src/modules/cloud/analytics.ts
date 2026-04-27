import * as crypto from "crypto";
import * as vscode from "vscode";
import * as Logger from "../Logger";
import { FIREBASE_CONFIG, getFreshAnonIdToken, getFreshIdToken } from "./firebaseApp";

/**
 * Safe analytics for the LeetCode Practice extension.
 *
 * Design constraints:
 *  - No raw PII in event payloads: no uid/email/username/problem slugs/note text.
 *    Only a pseudonymous per-install UUID identifies the sender.
 *  - Every string field is drawn from a compile-time allow-list (AnalyticsEvent,
 *    AnalyticsSurface, AnalyticsFeature) and enforced again by Firestore rules.
 *  - Writes are gated on (a) user setting `leetcodePractice.analytics.enabled`
 *    and (b) `vscode.env.isTelemetryEnabled`. If either is false, track() is a
 *    silent no-op. Sign-in is NOT required: if the user has a signed-in cloud
 *    identity it's used, otherwise a per-install anonymous Firebase identity
 *    is minted on first flush.
 *  - Events are buffered in memory and batched to Firestore via the `:commit`
 *    REST endpoint. No per-event network call. Failures are swallowed.
 *  - Per-install daily cap of MAX_EVENTS_PER_DAY drops excess events locally.
 *  - Payloads are tiny: ≤ 6 `props` keys, strings ≤ 32 chars; rules re-enforce.
 *
 * Read access to /logs is restricted to a single admin uid by firestore.rules;
 * no user — including the author of an event — can read logs back.
 */

export const ANALYTICS_SCHEMA_VERSION = 1;

const INSTALL_ID_KEY = "leetcode-practice.analytics.installId";
const DAILY_COUNT_KEY = "leetcode-practice.analytics.dailyCount";
const ANALYTICS_SETTING = "analytics.enabled";

const MAX_BUFFER = 50;
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 60_000;
const MAX_COMMIT_WRITES = 20;
const MAX_EVENTS_PER_DAY = 200;

// ---------------------------------------------------------------------------
// Allow-listed enums. Changing these requires coordinated rules + schemaVersion
// updates. Firestore rules validate that string fields match these values.
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | "activation"
  | "command_invoked"
  | "problem_opened"
  | "example_run"
  | "run_in_terminal"
  | "agent_action"
  | "interview_started"
  | "interview_ended"
  | "cloud_sync"
  | "opt_in_change"
  | "daily_login"
  | "focus_mode";

const EVENTS: ReadonlySet<AnalyticsEvent> = new Set<AnalyticsEvent>([
  "activation",
  "command_invoked",
  "problem_opened",
  "example_run",
  "run_in_terminal",
  "agent_action",
  "interview_started",
  "interview_ended",
  "cloud_sync",
  "opt_in_change",
  "daily_login",
  "focus_mode",
]);

export type AnalyticsSurface =
  | "command_palette"
  | "sidebar"
  | "webview"
  | "uri_handler"
  | "status_bar"
  | "context_menu"
  | "auto";

const SURFACES: ReadonlySet<AnalyticsSurface> = new Set<AnalyticsSurface>([
  "command_palette",
  "sidebar",
  "webview",
  "uri_handler",
  "status_bar",
  "context_menu",
  "auto",
]);

export type AnalyticsFeature =
  | "open_problem"
  | "open_qotd"
  | "open_random"
  | "mark_solved"
  | "mark_interview_solved"
  | "mark_attempting"
  | "clear_status"
  | "run_examples"
  | "run_in_terminal"
  | "agent_make_runnable"
  | "agent_hint"
  | "agent_analyze"
  | "agent_explain"
  | "view_stats"
  | "switch_study_plan"
  | "switch_problem_list"
  | "set_daily_goal"
  | "interview_start"
  | "interview_stop"
  | "interview_ai_gen"
  | "open_interview_report"
  | "push_cloud_stats"
  | "pull_cloud_stats"
  | "cloud_sign_in"
  | "cloud_sign_out"
  | "set_cloud_username"
  | "focus_enter"
  | "focus_exit"
  | "apply_theme"
  | "filter_difficulty"
  | "search_problems"
  | "refresh_problems"
  | "refresh_qotd"
  | "refresh_contests"
  | "open_contest_on_web"
  | "refresh_companies"
  | "search_companies"
  | "open_company_problem"
  | "sign_in"
  | "sign_out"
  | "open_hint_analysis"
  | "save_note"
  | "activation"
  | "daily_login"
  | "analytics_opt_in"
  | "analytics_opt_out";

const FEATURES: ReadonlySet<AnalyticsFeature> = new Set<AnalyticsFeature>([
  "open_problem",
  "open_qotd",
  "open_random",
  "mark_solved",
  "mark_interview_solved",
  "mark_attempting",
  "clear_status",
  "run_examples",
  "run_in_terminal",
  "agent_make_runnable",
  "agent_hint",
  "agent_analyze",
  "agent_explain",
  "view_stats",
  "switch_study_plan",
  "switch_problem_list",
  "set_daily_goal",
  "interview_start",
  "interview_stop",
  "interview_ai_gen",
  "open_interview_report",
  "push_cloud_stats",
  "pull_cloud_stats",
  "cloud_sign_in",
  "cloud_sign_out",
  "set_cloud_username",
  "focus_enter",
  "focus_exit",
  "apply_theme",
  "filter_difficulty",
  "search_problems",
  "refresh_problems",
  "refresh_qotd",
  "refresh_contests",
  "open_contest_on_web",
  "refresh_companies",
  "search_companies",
  "open_company_problem",
  "sign_in",
  "sign_out",
  "open_hint_analysis",
  "save_note",
  "activation",
  "daily_login",
  "analytics_opt_in",
  "analytics_opt_out",
]);

// Props are a tiny, strongly-typed bag. Keys outside this union are dropped.
export interface AnalyticsProps {
  difficulty?: "E" | "M" | "H";
  language?: "ts" | "js" | "py" | "cpp";
  result?: "ok" | "err";
  durationBucket?: "0_5m" | "5_15m" | "15_60m" | "60m+";
  countBucket?: "1_5" | "6_15" | "16_50" | "50+";
  source?: "panel" | "ai" | "url" | "random" | "qotd" | "sidebar" | "editor";
}

const PROP_KEYS: ReadonlySet<keyof AnalyticsProps> = new Set([
  "difficulty",
  "language",
  "result",
  "durationBucket",
  "countBucket",
  "source",
]);

const PROP_VALUES: Record<keyof AnalyticsProps, ReadonlySet<string>> = {
  difficulty: new Set(["E", "M", "H"]),
  language: new Set(["ts", "js", "py", "cpp"]),
  result: new Set(["ok", "err"]),
  durationBucket: new Set(["0_5m", "5_15m", "15_60m", "60m+"]),
  countBucket: new Set(["1_5", "6_15", "16_50", "50+"]),
  source: new Set(["panel", "ai", "url", "random", "qotd", "sidebar", "editor"]),
};

// ---------------------------------------------------------------------------
// Bucketing helpers — use these rather than passing raw numbers/strings.
// ---------------------------------------------------------------------------

export function bucketDifficulty(raw: string | undefined): "E" | "M" | "H" | undefined {
  if (!raw) return undefined;
  const d = raw.toUpperCase();
  if (d.startsWith("E")) return "E";
  if (d.startsWith("M")) return "M";
  if (d.startsWith("H")) return "H";
  return undefined;
}

export function bucketLanguage(raw: string | undefined): "ts" | "js" | "py" | "cpp" | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s === "typescript" || s === "ts") return "ts";
  if (s === "javascript" || s === "js") return "js";
  if (s === "python" || s === "py" || s === "python3") return "py";
  if (s === "cpp" || s === "c++") return "cpp";
  return undefined;
}

export function bucketDurationMin(mins: number): "0_5m" | "5_15m" | "15_60m" | "60m+" {
  if (mins < 5) return "0_5m";
  if (mins < 15) return "5_15m";
  if (mins < 60) return "15_60m";
  return "60m+";
}

export function bucketCount(n: number): "1_5" | "6_15" | "16_50" | "50+" {
  if (n <= 5) return "1_5";
  if (n <= 15) return "6_15";
  if (n <= 50) return "16_50";
  return "50+";
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface QueuedEvent {
  schemaVersion: number;
  ts: number;
  installId: string;
  extVersion: string;
  vscodeVersion: string;
  platform: string;
  locale: string;
  hourBucket: number;
  event: AnalyticsEvent;
  surface: AnalyticsSurface;
  feature: AnalyticsFeature;
  props: Record<string, string>;
}

let moduleContext: vscode.ExtensionContext | null = null;
let installId: string | null = null;
let extVersion = "";
const buffer: QueuedEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;

/** Initialise analytics. Safe to call even if the user has opted out. */
export async function initAnalytics(context: vscode.ExtensionContext): Promise<void> {
  moduleContext = context;
  extVersion = String((context.extension?.packageJSON as { version?: string })?.version ?? "");
  installId = await ensureInstallId(context.globalState);
  // Emit one activation event per session.
  track("activation", "auto", "activation");
}

export function disposeAnalytics(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  moduleContext = null;
  installId = null;
  buffer.length = 0;
}

/**
 * Record a single analytics event.
 *
 * This is a fire-and-forget best-effort API. It never throws, never blocks,
 * never surfaces errors to the user. If any gate (setting, telemetry,
 * sign-in) is closed, the call is a silent no-op.
 */
export function track(
  event: AnalyticsEvent,
  surface: AnalyticsSurface,
  feature: AnalyticsFeature,
  props?: AnalyticsProps
): void {
  try {
    if (!moduleContext || !installId) return;
    if (!isAnalyticsEnabled()) return;
    if (!EVENTS.has(event) || !SURFACES.has(surface) || !FEATURES.has(feature)) return;

    const dailyOk = bumpDailyCount(moduleContext.globalState);
    if (!dailyOk) return;

    const safeProps = sanitizeProps(props);
    const now = new Date();
    const queued: QueuedEvent = {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      ts: now.getTime(),
      installId,
      extVersion,
      vscodeVersion: vscode.version,
      platform: normalisePlatform(process.platform),
      locale: sanitiseString(vscode.env.language, 10),
      hourBucket: now.getHours(),
      event,
      surface,
      feature,
      props: safeProps,
    };
    buffer.push(queued);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

    if (buffer.length >= FLUSH_THRESHOLD) {
      scheduleImmediateFlush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushAnalytics();
      }, FLUSH_INTERVAL_MS);
    }
  } catch (e) {
    // Analytics must never break the extension.
    Logger.logError("analytics.track threw", e);
  }
}

/** Force-flush any pending events. Safe to call on deactivate. */
export async function flushAnalytics(): Promise<void> {
  if (!moduleContext || !installId) return;
  if (flushInFlight) return;
  if (buffer.length === 0) return;
  if (!isAnalyticsEnabled()) {
    // Drop silently if user disabled between buffering and flush.
    buffer.length = 0;
    return;
  }
  // Prefer the signed-in (Google) identity if the user has cloud sync set up.
  // Otherwise mint/reuse an anonymous Firebase identity so analytics works
  // without sign-in. Either path satisfies the `request.auth != null` rule
  // on /logs.
  const idToken =
    (await getFreshIdToken(moduleContext)) ?? (await getFreshAnonIdToken(moduleContext));
  if (!idToken) return;

  flushInFlight = true;
  try {
    while (buffer.length > 0) {
      const chunk = buffer.splice(0, MAX_COMMIT_WRITES);
      const ok = await commitWrites(chunk, idToken);
      if (!ok) {
        // Put events back at the head, cap by MAX_BUFFER, and stop — network
        // pressure; retry on next flush tick. Never retry inline.
        buffer.unshift(...chunk);
        if (buffer.length > MAX_BUFFER) buffer.splice(MAX_BUFFER);
        break;
      }
    }
  } finally {
    flushInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

export function isAnalyticsEnabled(): boolean {
  if (!vscode.env.isTelemetryEnabled) return false;
  const cfg = vscode.workspace.getConfiguration("leetcodePractice");
  const enabled = cfg.get<boolean>(ANALYTICS_SETTING);
  return enabled !== false;
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("leetcodePractice");
  await cfg.update(ANALYTICS_SETTING, enabled, vscode.ConfigurationTarget.Global);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function scheduleImmediateFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  setImmediate(() => void flushAnalytics());
}

async function ensureInstallId(globalState: vscode.Memento): Promise<string> {
  const existing = globalState.get<string>(INSTALL_ID_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = cryptoRandomUuid();
  await globalState.update(INSTALL_ID_KEY, id);
  return id;
}

function cryptoRandomUuid(): string {
  // Node ≥14.17 ships crypto.randomUUID; fall back just in case.
  const anyCrypto = crypto as unknown as { randomUUID?: () => string };
  if (typeof anyCrypto.randomUUID === "function") return anyCrypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function bumpDailyCount(globalState: vscode.Memento): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const cur = globalState.get<{ date: string; n: number }>(DAILY_COUNT_KEY);
  const next = cur && cur.date === today ? { date: today, n: cur.n + 1 } : { date: today, n: 1 };
  if (next.n > MAX_EVENTS_PER_DAY) return false;
  // Fire-and-forget persist; Memento.update returns a Thenable but drift of
  // ±1 event across sessions is acceptable.
  void globalState.update(DAILY_COUNT_KEY, next);
  return true;
}

function normalisePlatform(p: string): "darwin" | "linux" | "win32" | "other" {
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

function sanitiseString(s: string | undefined, max: number): string {
  if (!s) return "";
  const t = String(s).slice(0, max).replace(/[^A-Za-z0-9_.\-]/g, "");
  return t;
}

function sanitizeProps(raw: AnalyticsProps | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const key of Object.keys(raw) as (keyof AnalyticsProps)[]) {
    if (count >= 6) break;
    if (!PROP_KEYS.has(key)) continue;
    const value = raw[key];
    if (typeof value !== "string") continue;
    const allowed = PROP_VALUES[key];
    if (!allowed.has(value)) continue;
    out[key] = value;
    count++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Firestore REST :commit
// ---------------------------------------------------------------------------

function logDocName(id: string): string {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/logs/${id}`;
}

function firestoreCommitUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
}

function clientDocId(): string {
  // 20-char alphanumeric, matches Firestore auto-id shape.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function commitWrites(events: QueuedEvent[], idToken: string): Promise<boolean> {
  const writes = events.map((e) => ({
    update: {
      name: logDocName(clientDocId()),
      fields: eventToFsFields(e),
    },
    currentDocument: { exists: false },
  }));
  try {
    const res = await fetch(firestoreCommitUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ writes }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      Logger.logError(`analytics commit failed: ${res.status}`, txt.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    Logger.logError("analytics commit threw", e);
    return false;
  }
}

function eventToFsFields(e: QueuedEvent): Record<string, unknown> {
  const propFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.props)) {
    propFields[k] = { stringValue: v };
  }
  return {
    schemaVersion: { integerValue: String(e.schemaVersion) },
    ts: { integerValue: String(e.ts) },
    installId: { stringValue: e.installId },
    extVersion: { stringValue: e.extVersion },
    vscodeVersion: { stringValue: e.vscodeVersion },
    platform: { stringValue: e.platform },
    locale: { stringValue: e.locale },
    hourBucket: { integerValue: String(e.hourBucket) },
    event: { stringValue: e.event },
    surface: { stringValue: e.surface },
    feature: { stringValue: e.feature },
    props: { mapValue: { fields: propFields } },
  };
}
