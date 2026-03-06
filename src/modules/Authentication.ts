import * as vscode from "vscode";
import * as Database from "./Database";

export async function signIn(context: vscode.ExtensionContext): Promise<void> {
  const email = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: "Email Address",
    prompt: "Enter your LeetCode account email (or a label for this session)",
    placeHolder: "you@example.com",
  });
  if (email === undefined) return;
  const cookie = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: "Cookies",
    prompt:
      "Paste your LeetCode cookies from DevTools → Application → Cookies → leetcode.com. Include both LEETCODE_SESSION and csrftoken (copy the full Cookie header or paste both values).",
    placeHolder: "LEETCODE_SESSION=...; csrftoken=...",
    password: true,
  });
  if (!cookie?.trim()) return;
  await Database.saveSession(context, cookie.trim());
  vscode.window.showInformationMessage(
    "Signed in to LeetCode. You can now Run and Submit from the problem view."
  );
  await vscode.commands.executeCommand("leetcode-practice.viewStats");
}

export async function signOut(context: vscode.ExtensionContext): Promise<void> {
  await Database.clearSession(context);
  vscode.window.showInformationMessage("LeetCode session cleared.");
}
