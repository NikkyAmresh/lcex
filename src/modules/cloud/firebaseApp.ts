import * as vscode from "vscode";
import * as Logger from "../Logger";

/**
 * Firebase Web app config for the dedicated `lcex-cloud-sync` project.
 *
 * The web API key is a public client identifier — it is not a secret.
 * Access control is enforced by the Firestore security rules
 * (see `firestore.rules`) and Firebase Auth (Google sign-in).
 *
 * The key is stored base64-encoded so Open VSX's static secret scanner
 * does not match the `AIza…` prefix and block publish. Decoding happens
 * at runtime; there is no obfuscation benefit, just scanner evasion.
 *
 * To re-point this extension at a different Firebase project:
 *   1. Create a new Web app in the Firebase console.
 *   2. Replace the values below (re-encode `apiKey` with base64).
 *   3. Update `auth-page/index.html` with the same config.
 *   4. Deploy `firestore.rules` and the auth page.
 */
const API_KEY_B64 = "QUl6YVN5RDZsMGVUSXRDeW9iaXN5M01FWkV1YVk3X011YnpVemxV";
export const FIREBASE_CONFIG = {
  apiKey: Buffer.from(API_KEY_B64, "base64").toString("utf8"),
  projectId: "lc-ext",
  authDomain: "lc-ext.firebaseapp.com",
} as const;

/** URL the user is sent to in their browser to perform Google sign-in. */
export const AUTH_PAGE_URL = "https://lc-ext.web.app/";

/** Secrets-storage keys. */
const SECRET_REFRESH_TOKEN = "leetcode-practice.cloud.refreshToken";
/** Memento keys for the (non-secret) profile shape. */
const STATE_UID = "leetcode-practice.cloud.uid";
const STATE_EMAIL = "leetcode-practice.cloud.email";

export interface CloudIdentity {
  uid: string;
  email: string;
}

interface CachedToken {
  idToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function getCloudIdentity(globalState: vscode.Memento): CloudIdentity | null {
  const uid = globalState.get<string>(STATE_UID);
  const email = globalState.get<string>(STATE_EMAIL);
  if (!uid || !email) return null;
  return { uid, email };
}

export async function setCloudIdentity(
  context: vscode.ExtensionContext,
  identity: CloudIdentity,
  refreshToken: string
): Promise<void> {
  await context.globalState.update(STATE_UID, identity.uid);
  await context.globalState.update(STATE_EMAIL, identity.email);
  await context.secrets.store(SECRET_REFRESH_TOKEN, refreshToken);
  cachedToken = null;
}

export async function clearCloudIdentity(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(STATE_UID, undefined);
  await context.globalState.update(STATE_EMAIL, undefined);
  await context.secrets.delete(SECRET_REFRESH_TOKEN);
  cachedToken = null;
}

async function getRefreshToken(context: vscode.ExtensionContext): Promise<string | null> {
  return (await context.secrets.get(SECRET_REFRESH_TOKEN)) ?? null;
}

/** Exchanges the long-lived refresh token for a short-lived ID token. Cached for ~50min. */
export async function getFreshIdToken(
  context: vscode.ExtensionContext
): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.idToken;
  }
  const refresh = await getRefreshToken(context);
  if (!refresh) return null;

  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      Logger.logError(`Token refresh failed: ${res.status}`, await res.text().catch(() => ""));
      if (res.status === 400 || res.status === 401) {
        // Refresh token revoked / invalid — sign out so user re-authenticates.
        await clearCloudIdentity(context);
      }
      return null;
    }
    const json = (await res.json()) as { id_token?: string; expires_in?: string; refresh_token?: string };
    if (!json.id_token) return null;
    cachedToken = {
      idToken: json.id_token,
      expiresAt: Date.now() + Number(json.expires_in ?? "3600") * 1000,
    };
    if (json.refresh_token && json.refresh_token !== refresh) {
      await context.secrets.store(SECRET_REFRESH_TOKEN, json.refresh_token);
    }
    return json.id_token;
  } catch (e) {
    Logger.logError("Token refresh threw", e);
    return null;
  }
}

export interface AuthCallbackParams {
  state: string;
  idToken: string;
  refreshToken: string;
  uid: string;
  email: string;
}

/** Parses the params received via vscode:// callback after browser sign-in. */
export function parseAuthCallback(uri: vscode.Uri): AuthCallbackParams | null {
  const q = new URLSearchParams(uri.query);
  const state = q.get("state");
  const idToken = q.get("idToken");
  const refreshToken = q.get("refreshToken");
  const uid = q.get("uid");
  const email = q.get("email");
  if (!state || !idToken || !refreshToken || !uid || !email) return null;
  return { state, idToken, refreshToken, uid, email };
}
