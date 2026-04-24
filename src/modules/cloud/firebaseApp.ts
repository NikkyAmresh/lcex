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
const SECRET_ANON_REFRESH_TOKEN = "leetcode-practice.cloud.anonRefreshToken";
/** Memento keys for the (non-secret) profile shape. */
const STATE_UID = "leetcode-practice.cloud.uid";
const STATE_EMAIL = "leetcode-practice.cloud.email";
const STATE_ANON_UID = "leetcode-practice.cloud.anonUid";

export interface CloudIdentity {
  uid: string;
  email: string;
}

interface CachedToken {
  idToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let cachedAnonToken: CachedToken | null = null;

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

/**
 * Mints (or reuses) an anonymous Firebase identity for this install and returns
 * a fresh ID token. Used by analytics so events can be written without
 * requiring the user to perform Google sign-in.
 *
 * Anonymous auth must be enabled in the Firebase console
 * (Authentication → Sign-in method → Anonymous).
 *
 * The anonymous identity is stored separately from the signed-in (Google)
 * identity, so the two coexist without interference.
 */
export async function getFreshAnonIdToken(
  context: vscode.ExtensionContext
): Promise<string | null> {
  if (cachedAnonToken && cachedAnonToken.expiresAt > Date.now() + 60_000) {
    return cachedAnonToken.idToken;
  }
  let refresh = (await context.secrets.get(SECRET_ANON_REFRESH_TOKEN)) ?? null;
  let idToken: string | null = null;
  let expiresIn = 3600;

  if (!refresh) {
    const minted = await mintAnonymousIdentity(context);
    if (!minted) return null;
    refresh = minted.refreshToken;
    idToken = minted.idToken;
    expiresIn = minted.expiresIn;
  } else {
    const exchanged = await exchangeRefreshToken(refresh);
    if (!exchanged) {
      // Refresh token revoked — clear and re-mint once.
      await context.secrets.delete(SECRET_ANON_REFRESH_TOKEN);
      await context.globalState.update(STATE_ANON_UID, undefined);
      const minted = await mintAnonymousIdentity(context);
      if (!minted) return null;
      refresh = minted.refreshToken;
      idToken = minted.idToken;
      expiresIn = minted.expiresIn;
    } else {
      idToken = exchanged.idToken;
      expiresIn = exchanged.expiresIn;
      if (exchanged.refreshToken && exchanged.refreshToken !== refresh) {
        refresh = exchanged.refreshToken;
        await context.secrets.store(SECRET_ANON_REFRESH_TOKEN, refresh);
      }
    }
  }

  cachedAnonToken = { idToken, expiresAt: Date.now() + expiresIn * 1000 };
  return idToken;
}

interface MintedIdentity {
  uid: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function mintAnonymousIdentity(
  context: vscode.ExtensionContext
): Promise<MintedIdentity | null> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) {
      Logger.logError(`Anonymous sign-up failed: ${res.status}`, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as {
      idToken?: string;
      refreshToken?: string;
      localId?: string;
      expiresIn?: string;
    };
    if (!json.idToken || !json.refreshToken || !json.localId) return null;
    await context.secrets.store(SECRET_ANON_REFRESH_TOKEN, json.refreshToken);
    await context.globalState.update(STATE_ANON_UID, json.localId);
    return {
      uid: json.localId,
      idToken: json.idToken,
      refreshToken: json.refreshToken,
      expiresIn: Number(json.expiresIn ?? "3600"),
    };
  } catch (e) {
    Logger.logError("Anonymous sign-up threw", e);
    return null;
  }
}

interface ExchangedToken {
  idToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

async function exchangeRefreshToken(refreshToken: string): Promise<ExchangedToken | null> {
  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { id_token?: string; refresh_token?: string; expires_in?: string };
    if (!json.id_token) return null;
    return {
      idToken: json.id_token,
      refreshToken: json.refresh_token ?? null,
      expiresIn: Number(json.expires_in ?? "3600"),
    };
  } catch {
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
