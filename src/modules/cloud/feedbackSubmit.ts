import * as vscode from "vscode";
import * as Logger from "../Logger";
import { FIREBASE_CONFIG, getCloudIdentity, getFreshAnonIdToken, getFreshIdToken } from "./firebaseApp";
import { clientDocId, ensureInstallId } from "./analytics";
import type { FeedbackDoc, FeedbackPlatform, FeedbackSource } from "../feedback/FeedbackState";
import type { FeedbackStats } from "../feedback/FeedbackStats";

/**
 * Writes one user feedback document to Firestore `feedback/{docId}`.
 *
 * Identity is the pseudonymous analytics install id. The email is attached
 * only when the user is signed in to Cloud Sync AND ticked the contact box;
 * in that case the signed-in token is required so the rules can check that
 * the address matches the token. Otherwise the anonymous identity is enough.
 */

const FETCH_TIMEOUT_MS = 8_000;
const COMMENT_MAX = 2000;
const EMAIL_MAX = 254;

/** C0 controls except tab and newline, plus DEL. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export interface BuildFeedbackInput {
  rating: number;
  comment: string;
  allowContact: boolean;
  source: FeedbackSource;
  stats: FeedbackStats;
  promptCount: number;
}

function normalisePlatform(p: string): FeedbackPlatform {
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

function nonNegativeInt(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Trims, drops control characters (keeps newlines and tabs) and caps the length. */
export function sanitizeComment(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim().slice(0, COMMENT_MAX);
}

export async function buildFeedbackDoc(
  context: vscode.ExtensionContext,
  input: BuildFeedbackInput
): Promise<FeedbackDoc> {
  const installId = await ensureInstallId(context.globalState);
  const identity = input.allowContact ? getCloudIdentity(context.globalState) : null;
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const doc: FeedbackDoc = {
    docId: clientDocId(),
    schemaVersion: 1,
    ts: Date.now(),
    installId,
    rating,
    comment: sanitizeComment(input.comment),
    allowContact: !!identity,
    extVersion: String(context.extension?.packageJSON?.version ?? "").slice(0, 32),
    vscodeVersion: (vscode.version ?? "").slice(0, 32),
    platform: normalisePlatform(process.platform),
    locale: (vscode.env.language ?? "").slice(0, 10),
    source: input.source,
    promptCount: nonNegativeInt(input.promptCount),
    weekSolves: nonNegativeInt(input.stats.weekSolves),
    weekMinutes: nonNegativeInt(input.stats.weekMinutes),
    level: Math.max(1, nonNegativeInt(input.stats.level)),
    totalSolved: nonNegativeInt(input.stats.totalSolved),
    streak: nonNegativeInt(input.stats.streak),
  };
  if (identity) doc.email = identity.email.slice(0, EMAIL_MAX);
  return doc;
}

function docName(docId: string): string {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/feedback/${docId}`;
}

function commitUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
}

function toFirestoreFields(doc: FeedbackDoc): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "docId" || value === undefined) continue;
    if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (typeof value === "number") fields[key] = { integerValue: String(Math.trunc(value)) };
    else fields[key] = { stringValue: String(value) };
  }
  return fields;
}

async function commitOnce(doc: FeedbackDoc, idToken: string): Promise<{ ok: boolean; status: number }> {
  const body = {
    writes: [
      {
        update: { name: docName(doc.docId), fields: toFirestoreFields(doc) },
        currentDocument: { exists: false },
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(commitUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    // 409 ALREADY_EXISTS: an earlier attempt landed before we saw its response.
    if (res.status === 409) return { ok: true, status: res.status };
    const txt = await res.text().catch(() => "");
    Logger.logError(`feedbackSubmit: commit failed ${res.status}`, txt.slice(0, 200));
    return { ok: false, status: res.status };
  } catch (e) {
    Logger.logError("feedbackSubmit: commit threw", e);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Delivers the document. Never throws; `true` means Firestore has it. */
export async function submitFeedbackDoc(
  context: vscode.ExtensionContext,
  doc: FeedbackDoc
): Promise<boolean> {
  let payload: FeedbackDoc = { ...doc };
  let idToken: string | null = null;

  if (payload.email) {
    idToken = await getFreshIdToken(context);
    if (!idToken) {
      // Signed out since the form was filled in: send it anonymously instead.
      delete payload.email;
      payload = { ...payload, allowContact: false };
    }
  }
  if (!idToken) idToken = (await getFreshIdToken(context)) ?? (await getFreshAnonIdToken(context));
  if (!idToken) {
    Logger.log("feedbackSubmit: no token available, keeping the submission for later");
    return false;
  }

  const first = await commitOnce(payload, idToken);
  if (first.ok) return true;
  // The rules only accept an email that matches the token. If that check
  // failed, still deliver the rating and comment without the address.
  if (first.status === 403 && payload.email) {
    delete payload.email;
    payload = { ...payload, allowContact: false };
    const second = await commitOnce(payload, idToken);
    return second.ok;
  }
  return false;
}
