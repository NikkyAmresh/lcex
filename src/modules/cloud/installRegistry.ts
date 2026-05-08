import * as os from "node:os";
import * as vscode from "vscode";
import * as Logger from "../Logger";
import { FIREBASE_CONFIG, getFreshAnonIdToken } from "./firebaseApp";

const STATE_LAST_REGISTERED_AT = "leetcode-practice.cloud.installLastRegisteredAt";
const STATE_LAST_REGISTERED_KEY = "leetcode-practice.cloud.installLastRegisteredKey";
const REGISTER_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

function currentSystemUsername(): string {
  try {
    return (os.userInfo().username ?? "").trim();
  } catch {
    return ((process.env.USER ?? process.env.USERNAME) ?? "").trim();
  }
}

function sanitizeKeyPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
}

function buildDocKey(username: string, platform: string): string | null {
  const u = sanitizeKeyPart(username);
  const p = sanitizeKeyPart(platform);
  if (!u || !p) return null;
  return `${u}__${p}`;
}

interface InstallFields {
  username: string;
  platform: string;
  hostname: string;
  release: string;
  arch: string;
  extVersion: string;
  vscodeVersion: string;
}

function gatherFields(context: vscode.ExtensionContext): InstallFields {
  return {
    username: currentSystemUsername().toLowerCase(),
    platform: process.platform,
    hostname: (os.hostname() ?? "").slice(0, 128),
    release: (os.release() ?? "").slice(0, 64),
    arch: (os.arch() ?? "").slice(0, 16),
    extVersion: (context.extension?.packageJSON?.version ?? "").toString().slice(0, 32),
    vscodeVersion: (vscode.version ?? "").slice(0, 32),
  };
}

async function patchInstallDoc(
  idToken: string,
  key: string,
  fields: InstallFields
): Promise<boolean> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}` +
    `/databases/(default)/documents/installs/${encodeURIComponent(key)}`;

  const body = {
    fields: {
      username: { stringValue: fields.username },
      platform: { stringValue: fields.platform },
      hostname: { stringValue: fields.hostname },
      release: { stringValue: fields.release },
      arch: { stringValue: fields.arch },
      extVersion: { stringValue: fields.extVersion },
      vscodeVersion: { stringValue: fields.vscodeVersion },
      lastAccessAt: { integerValue: String(Date.now()) },
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      Logger.logError(
        `installRegistry: PATCH failed ${res.status}`,
        await res.text().catch(() => "")
      );
      return false;
    }
    return true;
  } catch (e) {
    Logger.logError("installRegistry: PATCH threw", e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Records this install's last-access timestamp in `installs/{username}__{platform}`.
 * Throttled to once per REGISTER_INTERVAL_MS per machine. The doc's contents
 * (hostname, arch, release, ext + vscode versions) help the admin identify
 * which username to ban when needed. The actual ban is still username-only.
 */
export async function recordInstallActivity(
  context: vscode.ExtensionContext
): Promise<void> {
  const fields = gatherFields(context);
  if (!fields.username) return;
  const key = buildDocKey(fields.username, fields.platform);
  if (!key) return;

  const last = context.globalState.get<number>(STATE_LAST_REGISTERED_AT) ?? 0;
  const lastKey = context.globalState.get<string>(STATE_LAST_REGISTERED_KEY);
  if (lastKey === key && Date.now() - last < REGISTER_INTERVAL_MS) return;

  const idToken = await getFreshAnonIdToken(context);
  if (!idToken) {
    Logger.log("installRegistry: no anon token, skipping registration");
    return;
  }

  const ok = await patchInstallDoc(idToken, key, fields);
  if (ok) {
    await context.globalState.update(STATE_LAST_REGISTERED_AT, Date.now());
    await context.globalState.update(STATE_LAST_REGISTERED_KEY, key);
  }
}
