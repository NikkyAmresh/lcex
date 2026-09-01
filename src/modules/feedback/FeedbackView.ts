import * as vscode from "vscode";
import * as Logger from "../Logger";
import { track as trackAnalytics } from "../cloud/analytics";
import { getConfiguredLeetcodeUsername } from "../cloud/cloudStatsSync";
import { buildFeedbackDoc, sanitizeComment, submitFeedbackDoc } from "../cloud/feedbackSubmit";
import { getCloudIdentity } from "../cloud/firebaseApp";
import { FOCUS_ZEN_STATUSBAR_PREV_KEY, PRACTICE_SECONDS_TOTAL_KEY, getTotalXp, todayIso } from "../Gamification";
import { getInterviewHistory, getInterviewSession } from "../InterviewMode";
import { getAllStatusEntries } from "../ProblemsProvider";
import { TIMER_BY_DAY_KEY, type TimerByDay } from "../ProblemTimer";
import {
  FEEDBACK_PROMPT_DELAY_MS,
  clearPendingFeedback,
  ensureFeedbackState,
  markOptedOut,
  markPrompted,
  markSubmitted,
  readFeedbackState,
  shouldPromptFeedback,
  type FeedbackSource,
  type PromptDecision,
} from "./FeedbackState";
import { renderFeedbackHtml } from "./FeedbackHtml";
import { composeFeedbackCopy, computeFeedbackStats, type FeedbackStats } from "./FeedbackStats";

/**
 * Weekly feedback prompt: the VS Code side. A personalised toast opens a
 * webview form (1 to 5 stars plus an optional comment). The same form is
 * available any time through `LeetCode: Send Feedback`.
 */

const FEEDBACK_SETTING = "feedback.enabled";
const VIEW_TYPE = "leetcodeFeedback";
const MARKETPLACE_REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=nikkyamresh.leetcode-practice&ssr=false#review-details";
const NEW_ISSUE_URL = "https://github.com/NikkyAmresh/lcex/issues/new";

const BTN_GIVE = "Give feedback";
const BTN_LATER = "Later";
const BTN_OPT_OUT = "Don't ask again";

let feedbackPanel: vscode.WebviewPanel | null = null;

export function isFeedbackPanelOpen(): boolean {
  return feedbackPanel !== null;
}

function isPromptEnabled(): boolean {
  return vscode.workspace.getConfiguration("leetcodePractice").get<boolean>(FEEDBACK_SETTING) !== false;
}

/** Reads every local signal the copy and the gate need. Cheap, synchronous. */
export function collectFeedbackStats(context: vscode.ExtensionContext): FeedbackStats {
  const gs = context.globalState;
  const practice = gs.get<number>(PRACTICE_SECONDS_TOTAL_KEY);
  return computeFeedbackStats({
    today: todayIso(),
    statusEntries: getAllStatusEntries(gs),
    timerByDay: gs.get<TimerByDay>(TIMER_BY_DAY_KEY) ?? {},
    practiceSecondsTotal: typeof practice === "number" ? practice : undefined,
    totalXp: getTotalXp(gs),
    interviewEndedAts: getInterviewHistory(gs)
      .map((h) => h.endedAt)
      .filter((t): t is number => typeof t === "number"),
    nowMs: Date.now(),
    leetcodeUsername: getConfiguredLeetcodeUsername(),
    cloudEmail: getCloudIdentity(gs)?.email ?? null,
  });
}

/**
 * Called once from `activate()`. Starts the eligibility clock right away and
 * runs the first check after a short delay so it never competes with startup.
 */
export function scheduleFeedbackPrompt(context: vscode.ExtensionContext): vscode.Disposable {
  try {
    const stats = collectFeedbackStats(context);
    void ensureFeedbackState(context.globalState, Date.now(), stats.earliestActivityMs).catch((e) =>
      Logger.logError("feedback: ensure state failed", e)
    );
  } catch (e) {
    Logger.logError("feedback: seeding state failed", e);
  }
  const timer = setTimeout(() => {
    void runFeedbackTick(context).catch((e) => Logger.logError("feedback: tick failed", e));
  }, FEEDBACK_PROMPT_DELAY_MS);
  return { dispose: () => clearTimeout(timer) };
}

/** Retries a submission that could not be delivered earlier. `true` when nothing is pending any more. */
export async function retryPendingFeedback(context: vscode.ExtensionContext): Promise<boolean> {
  const gs = context.globalState;
  const state = readFeedbackState(gs, Date.now());
  if (!state.pending) return true;
  const ok = await submitFeedbackDoc(context, state.pending);
  if (ok) {
    await clearPendingFeedback(gs);
    Logger.log("feedback: pending submission delivered");
  }
  return ok;
}

export async function runFeedbackTick(
  context: vscode.ExtensionContext,
  opts?: { force?: boolean }
): Promise<void> {
  const gs = context.globalState;
  await retryPendingFeedback(context);
  const now = Date.now();
  const state = await ensureFeedbackState(gs, now);
  const stats = collectFeedbackStats(context);
  const decision: PromptDecision = opts?.force
    ? { prompt: true }
    : shouldPromptFeedback({
        now,
        state,
        settingEnabled: isPromptEnabled(),
        interviewActive: !!getInterviewSession(gs),
        focusModeActive: context.workspaceState.get(FOCUS_ZEN_STATUSBAR_PREV_KEY) !== undefined,
        panelOpen: isFeedbackPanelOpen(),
        totalSolved: stats.totalSolved,
        totalPracticeSeconds: stats.totalPracticeSeconds,
      });
  if (!decision.prompt) {
    Logger.log(`feedback: skip (${decision.reason})`);
    return;
  }
  Logger.log("feedback: prompting");
  await showFeedbackPrompt(context, stats);
}

async function showFeedbackPrompt(context: vscode.ExtensionContext, stats: FeedbackStats): Promise<void> {
  const gs = context.globalState;
  const copy = composeFeedbackCopy(stats);
  // Recorded before the toast is shown, so every way of dismissing it snoozes a week.
  await markPrompted(gs, Date.now());
  trackAnalytics("command_invoked", "auto", "feedback_prompt_shown");
  const choice = await vscode.window.showInformationMessage(copy.notification, BTN_GIVE, BTN_LATER, BTN_OPT_OUT);
  if (choice === BTN_GIVE) {
    trackAnalytics("command_invoked", "auto", "feedback_opened");
    await openFeedbackWebview(context, { source: "prompt" });
  } else if (choice === BTN_LATER) {
    trackAnalytics("command_invoked", "auto", "feedback_prompt_later");
  } else if (choice === BTN_OPT_OUT) {
    await markOptedOut(gs, Date.now());
    trackAnalytics("command_invoked", "auto", "feedback_prompt_opt_out");
    Logger.log("feedback: user opted out");
  }
}

type PageMessage =
  | { type: "submit"; rating?: unknown; comment?: unknown; allowContact?: unknown }
  | { type: "retry" }
  | { type: "openExternal"; target?: unknown }
  | { type: "close" };

export async function openFeedbackWebview(
  context: vscode.ExtensionContext,
  opts: { source: FeedbackSource }
): Promise<void> {
  if (feedbackPanel) {
    try {
      feedbackPanel.reveal(feedbackPanel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    } catch {
      feedbackPanel = null;
    }
  }

  const gs = context.globalState;
  const stats = collectFeedbackStats(context);
  const copy = composeFeedbackCopy(stats);
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Send Feedback", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  const icon = vscode.Uri.joinPath(context.extensionUri, "icons", "logo-dark-16.png");
  panel.iconPath = { light: icon, dark: icon };
  feedbackPanel = panel;
  panel.onDidDispose(() => {
    if (feedbackPanel === panel) feedbackPanel = null;
  });

  const logoUri = panel.webview
    .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "icons", "logo-dark.png"))
    .toString();
  panel.webview.html = renderFeedbackHtml(panel.webview.cspSource, {
    headline: copy.headline,
    summary: copy.summary,
    tiles: copy.tiles,
    displayName: stats.displayName,
    signedInEmail: getCloudIdentity(gs)?.email ?? null,
    logoUri,
  });

  const post = async (msg: unknown): Promise<void> => {
    try {
      await panel.webview.postMessage(msg);
    } catch {
      /* panel disposed mid-await */
    }
  };

  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const m = raw as PageMessage;
    if (!m || typeof m !== "object" || typeof m.type !== "string") return;

    if (m.type === "close") {
      panel.dispose();
      return;
    }

    if (m.type === "openExternal") {
      const url = m.target === "marketplace" ? MARKETPLACE_REVIEW_URL : m.target === "issues" ? NEW_ISSUE_URL : null;
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }

    if (m.type === "retry") {
      const pendingRating = readFeedbackState(gs, Date.now()).pending?.rating ?? 0;
      const delivered = await retryPendingFeedback(context);
      await post({ type: "submitted", rating: pendingRating, delivered });
      return;
    }

    if (m.type === "submit") {
      const rating =
        typeof m.rating === "number" && Number.isInteger(m.rating) && m.rating >= 1 && m.rating <= 5 ? m.rating : 0;
      if (!rating) return;
      const comment = sanitizeComment(typeof m.comment === "string" ? m.comment : "");
      const allowContact = m.allowContact === true && !!getCloudIdentity(gs);
      const now = Date.now();
      const state = readFeedbackState(gs, now);
      const doc = await buildFeedbackDoc(context, {
        rating,
        comment,
        allowContact,
        source: opts.source,
        stats: collectFeedbackStats(context),
        promptCount: state.promptCount,
      });
      // Marked first: the user is never asked again, even if the network is down.
      await markSubmitted(gs, now, doc);
      const delivered = await submitFeedbackDoc(context, doc);
      if (delivered) await clearPendingFeedback(gs, now);
      trackAnalytics("command_invoked", "webview", "feedback_submitted", { result: delivered ? "ok" : "err" });
      Logger.log(`feedback: submitted rating=${rating} delivered=${delivered}`);
      await post({ type: "submitted", rating, delivered });
    }
  });
}
