import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import * as Logger from "../Logger";
import {
  AUTH_PAGE_URL,
  type AuthCallbackParams,
  clearCloudIdentity,
  getCloudIdentity,
  setCloudIdentity,
} from "./firebaseApp";

const PUBLISHER = "nikkyamresh";
const EXTENSION_ID = "leetcode-practice";
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingSignIn {
  state: string;
  resolve: (params: AuthCallbackParams) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let pending: PendingSignIn | null = null;

/** Called by the URI handler when a `/auth` callback arrives. */
export function handleAuthCallback(params: AuthCallbackParams): boolean {
  if (!pending || pending.state !== params.state) {
    Logger.log("Auth callback received but no matching pending sign-in.");
    return false;
  }
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  p.resolve(params);
  return true;
}

export async function signInToCloud(context: vscode.ExtensionContext): Promise<boolean> {
  if (pending) {
    pending.reject(new Error("Superseded by a new sign-in."));
    clearTimeout(pending.timer);
    pending = null;
  }

  const state = randomBytes(24).toString("hex");
  const callback = vscode.Uri.parse(
    `${vscode.env.uriScheme}://${PUBLISHER}.${EXTENSION_ID}/auth`
  );
  const url = new URL(AUTH_PAGE_URL);
  url.searchParams.set("state", state);
  url.searchParams.set("callback", callback.toString());

  const opened = await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  if (!opened) {
    void vscode.window.showErrorMessage("Could not open browser for cloud sign-in.");
    return false;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for browser sign-in… (cancel to abort)",
      cancellable: true,
    },
    async (_progress, token) => {
      const params = await new Promise<AuthCallbackParams | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending && pending.state === state) {
            pending = null;
            reject(new Error("Sign-in timed out after 5 minutes."));
          }
        }, SIGN_IN_TIMEOUT_MS);
        pending = {
          state,
          resolve: (p) => resolve(p),
          reject: (e) => reject(e),
          timer,
        };
        token.onCancellationRequested(() => {
          if (pending && pending.state === state) {
            clearTimeout(pending.timer);
            pending = null;
            resolve(null);
          }
        });
      }).catch((e: Error) => {
        void vscode.window.showErrorMessage(`Cloud sign-in failed: ${e.message}`);
        return null;
      });
      return params;
    }
  );

  if (!result) return false;

  await setCloudIdentity(
    context,
    { uid: result.uid, email: result.email },
    result.refreshToken
  );
  void vscode.window.showInformationMessage(`Signed in to cloud as ${result.email}.`);
  return true;
}

export async function signOutFromCloud(context: vscode.ExtensionContext): Promise<void> {
  await clearCloudIdentity(context);
  void vscode.window.showInformationMessage("Signed out from cloud.");
}

export function describeCloudIdentity(globalState: vscode.Memento): string {
  const id = getCloudIdentity(globalState);
  return id ? `Signed in as ${id.email}` : "Not signed in";
}
