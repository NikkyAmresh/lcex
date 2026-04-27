import * as vscode from "vscode";
import type { ProblemListItem } from "./LeetCode";
import type { ContestSummary } from "./LeetCode";

export type ContestSetupStartHandler = (
  contestSlug: string
) => Promise<{ ok: true } | { ok: false; message: string }>;

export type ContestSetupOpenProblemHandler = (titleSlug: string) => Promise<void>;

let panel: vscode.WebviewPanel | null = null;
let onStart: ContestSetupStartHandler | null = null;
let onOpenProblem: ContestSetupOpenProblemHandler | null = null;
let currentSlug: string | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatStartTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHtml(contest: ContestSummary, problems: ProblemListItem[]): string {
  const minutes = Math.max(1, Math.round(contest.duration / 60));
  const dateStr = formatStartTime(contest.startTime);
  const rows = problems
    .map((p, i) => {
      const idx = i + 1;
      const title = escapeHtml(p.title);
      const slug = escapeHtml(p.titleSlug);
      const diff = escapeHtml(p.difficulty);
      return `
        <button type="button" class="row" data-slug="${slug}">
          <div class="row-num">Q${idx}</div>
          <div class="row-body">
            <div class="row-title">${title}</div>
            <div class="row-meta">${diff}</div>
          </div>
        </button>`;
    })
    .join("");
  const empty =
    problems.length === 0
      ? `<p class="empty">No problems found for this contest.</p>`
      : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Contest setup</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --text: #e5e5e5;
      --muted: #9d9d9d;
      --accent: #ffa116;
      --border: #3c3c3c;
      --field: #252526;
      --hover: rgba(255,255,255,0.06);
    }
    body {
      margin: 0;
      padding: 24px;
      max-width: 640px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 14px;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255,161,22,0.15);
      color: var(--accent);
      margin-left: 8px;
      vertical-align: middle;
    }
    .lead { color: var(--muted); margin: 0 0 18px; font-size: 13px; }
    .meta {
      display: flex;
      gap: 18px;
      margin: 0 0 22px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--field);
      font-size: 13px;
    }
    .meta div { display: flex; flex-direction: column; }
    .meta .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .meta .v { color: var(--text); font-weight: 500; }
    .section-title {
      font-size: 12px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.06em;
      margin: 0 0 10px;
    }
    .list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .row {
      display: flex;
      gap: 14px;
      align-items: center;
      width: 100%;
      text-align: left;
      padding: 12px 14px;
      border: none;
      border-bottom: 1px solid var(--border);
      background: var(--field);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      cursor: pointer;
      box-sizing: border-box;
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--hover); }
    .row-num { color: var(--muted); width: 32px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .row-body { flex: 1; min-width: 0; }
    .row-title { font-weight: 500; margin-bottom: 4px; }
    .row-meta { font-size: 12px; color: var(--muted); }
    .empty { color: var(--muted); padding: 16px; border: 1px dashed var(--border); border-radius: 8px; text-align: center; }
    .actions { margin-top: 24px; display: flex; gap: 12px; align-items: center; }
    button#startBtn {
      font-size: 14px;
      padding: 10px 22px;
      border: none;
      border-radius: 6px;
      background: var(--accent);
      color: #000;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    button#startBtn:hover { filter: brightness(1.05); }
    button#startBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    .hint { color: var(--muted); font-size: 12px; }
    .err { color: #f48771; font-size: 12px; margin-top: 12px; display: none; }
    .err.show { display: block; }
  </style>
</head>
<body>
  <h1>${escapeHtml(contest.title)}<span class="badge">contest</span></h1>
  <p class="lead">Recreate this contest as a timed practice session. Same problems, same time limit. A report is saved on stop or timeout.</p>
  <div class="meta">
    <div><span class="k">Duration</span><span class="v">${minutes} minutes</span></div>
    <div><span class="k">Problems</span><span class="v">${problems.length}</span></div>
    <div><span class="k">Originally held</span><span class="v">${escapeHtml(dateStr)}</span></div>
  </div>
  <p class="section-title">Problems</p>
  ${empty}
  <div class="list" role="list">${rows}</div>
  <div class="actions">
    <button type="button" id="startBtn"${problems.length === 0 ? " disabled" : ""}>Start Contest</button>
    <span class="hint">${minutes} min timer · Focus mode engages · Click problems above to peek without starting</span>
  </div>
  <p class="err" id="err"></p>
  <script>
    (function () {
      var vscode = acquireVsCodeApi();
      var btn = document.getElementById("startBtn");
      var err = document.getElementById("err");
      function showErr(msg) {
        err.textContent = msg || "";
        err.classList.toggle("show", !!msg);
      }
      btn.addEventListener("click", function () {
        showErr("");
        btn.disabled = true;
        vscode.postMessage({ type: "start" });
      });
      document.querySelector(".list").addEventListener("click", function (ev) {
        var row = ev.target.closest(".row");
        if (!row || !row.dataset.slug) return;
        vscode.postMessage({ type: "openProblem", titleSlug: row.dataset.slug });
      });
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (!d || d.type !== "resetStart") return;
        btn.disabled = false;
        if (d.message) showErr(d.message);
      });
    })();
  </script>
</body>
</html>`;
}

export function openContestSetupWebview(
  context: vscode.ExtensionContext,
  contest: ContestSummary,
  problems: ProblemListItem[],
  handlers: { onStart: ContestSetupStartHandler; onOpenProblem: ContestSetupOpenProblemHandler }
): void {
  onStart = handlers.onStart;
  onOpenProblem = handlers.onOpenProblem;
  currentSlug = contest.titleSlug;
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "leetcodeContestSetup",
      `Contest — ${contest.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(() => {
      panel = null;
      onStart = null;
      onOpenProblem = null;
      currentSlug = null;
    });
    panel.webview.onDidReceiveMessage(async (raw) => {
      const m = raw as { type?: string; titleSlug?: string };
      if (!m || typeof m !== "object") return;
      if (m.type === "start") {
        const fn = onStart;
        const slug = currentSlug;
        if (!fn || !slug) return;
        const result = await fn(slug);
        if (!result.ok && panel) {
          panel.webview.postMessage({ type: "resetStart", message: result.message });
        }
        return;
      }
      if (m.type === "openProblem" && typeof m.titleSlug === "string" && m.titleSlug.trim()) {
        await onOpenProblem?.(m.titleSlug.trim());
      }
    });
  } else {
    panel.title = `Contest — ${contest.title}`;
  }
  panel.webview.html = renderHtml(contest, problems);
  panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One);
}

export function disposeContestSetupView(): void {
  panel?.dispose();
  panel = null;
}
