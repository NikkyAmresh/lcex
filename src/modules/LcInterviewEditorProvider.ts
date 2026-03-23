import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { IProblemProvider } from "./interface/Problem";
import {
  defaultInterviewNameFromDate,
  parseLcInterviewFile,
  serializeLcInterviewFile,
  type LcInterviewFileV1,
} from "./LcInterviewFile";
import { normalizeInterviewFilePath } from "./LcexInterviewReportStore";
import { getInterviewSession, remainingMs } from "./InterviewMode";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeInterviewDirectoryName(name: string): string {
  const t = name.trim() || "interview";
  const safe = t.replace(/[/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return safe.length > 0 ? safe : "interview";
}

function formatTitleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatAttemptTimeLabel(iso: string): string {
  const t = iso.trim();
  if (t.length >= 16) return t.slice(0, 16).replace("T", " ");
  return t || "—";
}

function buildInterviewFileDisplayLabel(fsPath: string): string {
  const full = normalizeInterviewFilePath(fsPath);
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    for (const f of folders) {
      const rel = path.relative(f.uri.fsPath, full);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        return rel;
      }
    }
  }
  const base = path.basename(full);
  const parent = path.basename(path.dirname(full));
  return `${base} · ${parent}`;
}

function getWebviewHtml(
  data: LcInterviewFileV1,
  problemRows: { titleSlug: string; title: string }[],
  canonicalPath: string,
  displayPath: string,
  pastAttempts: { id: string; time: string; absPath: string; exists: boolean }[]
): string {
  const dm = data.durationMinutes;
  const durationLabel = dm === 180 ? "3 h" : `${dm} min`;
  const problems = data.problems ?? [];
  const rows =
    problems.length === 0
      ? '<p class="empty">No problems in this file.</p>'
      : problemRows
          .map(
            (row) => `
    <button type="button" class="prob-row prob-row-disabled" disabled data-slug="${escapeHtml(row.titleSlug)}" title="${escapeHtml(row.titleSlug)}">
      <span class="doc-icon" aria-hidden="true"></span>
      <span class="prob-title">${escapeHtml(row.title)}</span>
    </button>`
          )
          .join("");
  const problemsJson = JSON.stringify(problems)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const pastSection =
    pastAttempts.length === 0
      ? ""
      : `<div id="pastAttemptsSection" class="past-section">
  <p class="section-title" style="margin-top:24px">Past attempts</p>
  <div id="pastAttempts">${pastAttempts
    .map(
      (a) => `
    <button type="button" class="past-row${a.exists ? "" : " past-row-missing"}" data-path="${escapeHtml(a.absPath)}">
      <span class="doc-icon doc-icon-sm" aria-hidden="true"></span>
      <span class="past-main">
        <span class="past-id">${escapeHtml(a.id)}</span>
        <span class="past-time">${escapeHtml(formatAttemptTimeLabel(a.time))}</span>
      </span>
    </button>`
    )
    .join("")}</div></div>`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><style>
:root { --bg:#1e1e1e; --text:#e5e5e5; --muted:#9d9d9d; --border:#3c3c3c; --field:#252526; --accent:#ffa116; }
body { margin:0; padding:0 0 28px; font-family:var(--vscode-font-family, sans-serif); font-size:13px; background:var(--bg); color:var(--text); }
.top-bar {
  position:sticky; top:0; z-index:4;
  display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;
  margin:0 0 20px; padding:14px 22px 16px;
  background:rgba(30,30,30,0.78);
  backdrop-filter:saturate(1.2) blur(12px);
  -webkit-backdrop-filter:saturate(1.2) blur(12px);
  border-bottom:1px solid rgba(255,255,255,0.06);
  box-shadow:0 1px 0 rgba(0,0,0,0.25);
}
.top-bar-inner { min-width:0; flex:1; }
h1 { font-size:15px; font-weight:600; margin:0; letter-spacing:-0.02em; color:var(--text); }
.path-row { margin-top:6px; display:flex; align-items:center; gap:8px; min-width:0; }
.path-pill {
  font-size:11px; color:var(--text);
  padding:4px 10px; border-radius:999px;
  background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.08);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;
}
.doc-icon {
  flex-shrink:0;
  width:18px; height:22px;
  border:1px solid var(--border);
  border-radius:3px;
  background:rgba(255,255,255,0.04);
  position:relative;
  box-sizing:border-box;
}
.doc-icon::after {
  content:"";
  position:absolute; left:4px; right:4px; top:6px;
  height:1px; background:var(--muted);
  box-shadow:0 4px 0 var(--muted), 0 8px 0 var(--muted);
}
.doc-icon-sm { width:15px; height:18px; }
.doc-icon-sm::after { top:5px; left:3px; right:3px; box-shadow:0 3px 0 var(--muted), 0 6px 0 var(--muted); }
.timer-row { display:none; align-items:center; gap:10px; padding:8px 12px; border-radius:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); font-variant-numeric:tabular-nums; flex-shrink:0; }
.timer-row.visible { display:flex; }
.timer-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; }
.timer-value { font-size:18px; font-weight:700; color:var(--accent); }
.body-pad { padding:0 22px; }
.meta { display:grid; gap:14px; margin-bottom:20px; max-width:520px; }
label { font-size:11px; color:var(--muted); display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em; }
.name-readonly { font-size:14px; font-weight:500; color:var(--text); padding:2px 0; line-height:1.4; }
.duration-pill { display:inline-block; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); font-size:13px; color:var(--text); font-variant-numeric:tabular-nums; }
.section-title { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin:0 0 10px; }
.prob-row { display:flex; align-items:center; gap:12px; width:100%; text-align:left; padding:12px 14px; margin-bottom:8px; border:1px solid var(--border); border-radius:8px; background:var(--field); color:var(--text); cursor:pointer; font:inherit; transition:border-color .12s, background .12s; }
.prob-row:hover:not(:disabled) { border-color:var(--accent); background:#2a2d2e; }
.prob-row:disabled, .prob-row.prob-row-disabled { opacity:0.5; cursor:not-allowed; }
.prob-title { font-weight:500; flex:1; min-width:0; }
.past-section { }
.past-section.hidden-during-run { display:none !important; }
.past-row { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:10px 14px; margin-bottom:6px; border:1px solid var(--border); border-radius:8px; background:var(--field); color:var(--text); cursor:pointer; font:inherit; font-size:12px; }
.past-row:hover { border-color:var(--accent); }
.past-row-missing { opacity:0.65; }
.past-main { display:flex; flex:1; align-items:center; justify-content:space-between; gap:12px; min-width:0; }
.past-id { font-family:var(--vscode-editor-font-family, monospace); color:var(--accent); }
.past-time { color:var(--muted); font-variant-numeric:tabular-nums; flex-shrink:0; }
.actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; align-items:center; }
.btn { padding:9px 20px; border:none; border-radius:6px; background:var(--accent); color:#000; font-weight:600; cursor:pointer; font-size:12px; }
.btn:disabled { opacity:0.45; cursor:not-allowed; }
.btn.secondary { background:#3c3c3c; color:var(--text); }
.btn.hidden { display:none !important; }
.err { color:#f48771; font-size:12px; margin-top:10px; display:none; }
.err.show { display:block; }
.empty { color:var(--muted); font-size:13px; margin:0; }
</style></head>
<body>
  <header class="top-bar">
    <div class="top-bar-inner">
      <h1>LC Interview</h1>
      <div class="path-row" title="${escapeHtml(canonicalPath)}">
        <span class="doc-icon doc-icon-sm" aria-hidden="true"></span>
        <span class="path-pill">${escapeHtml(displayPath)}</span>
      </div>
    </div>
    <div class="timer-row" id="timerRow">
      <span class="timer-label">Interview</span>
      <span class="timer-value" id="timerText">0:00</span>
    </div>
  </header>
  <div class="body-pad">
  <div class="meta">
    <div>
      <label>Name</label>
      <div class="name-readonly" id="nameReadonly">${escapeHtml(data.name)}</div>
    </div>
    <div>
      <label>Duration</label>
      <span class="duration-pill">${escapeHtml(durationLabel)}</span>
    </div>
  </div>
  <p class="section-title">Problems</p>
  <div id="problems">${rows}</div>
  <div class="actions">
    <button type="button" class="btn" id="startBtn">Start interview</button>
    <button type="button" class="btn secondary hidden" id="endBtn">End interview</button>
  </div>
  <p class="err" id="err"></p>
  ${pastSection}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const PLAN_PROBLEMS = ${problemsJson};
    const FILE_DURATION = ${JSON.stringify(dm)};
    const FILE_NAME = ${JSON.stringify((data.name && data.name.trim()) || defaultInterviewNameFromDate())};
    function showErr(m) {
      var e = document.getElementById("err");
      e.textContent = m || "";
      e.classList.toggle("show", !!m);
    }
    document.getElementById("startBtn").addEventListener("click", function () {
      showErr("");
      const name = (FILE_NAME && String(FILE_NAME).trim()) ? String(FILE_NAME).trim() : ${JSON.stringify(defaultInterviewNameFromDate())};
      if (FILE_DURATION !== 45 && FILE_DURATION !== 60 && FILE_DURATION !== 180) {
        showErr("Invalid duration in file (must be 45, 60, or 180).");
        return;
      }
      if (!PLAN_PROBLEMS.length) { showErr("Add problems to the JSON file first."); return; }
      vscode.postMessage({
        type: "startInterview",
        data: { version: 1, name: name, durationMinutes: FILE_DURATION, problems: PLAN_PROBLEMS }
      });
    });
    var endBtn = document.getElementById("endBtn");
    endBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "endInterview" });
    });
    document.querySelectorAll(".prob-row").forEach(function (el) {
      el.addEventListener("click", function () {
        if (el.disabled || el.classList.contains("prob-row-disabled")) return;
        var slug = el.getAttribute("data-slug");
        if (slug) vscode.postMessage({ type: "openProblem", titleSlug: slug });
      });
    });
    document.querySelectorAll(".past-row").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = el.getAttribute("data-path");
        if (p) vscode.postMessage({ type: "openPastReport", reportPath: p });
      });
    });
    window.addEventListener("message", function (event) {
      var m = event.data;
      if (!m || m.type !== "interviewState") return;
      var timerRow = document.getElementById("timerRow");
      var timerText = document.getElementById("timerText");
      var startBtn = document.getElementById("startBtn");
      var pastSec = document.getElementById("pastAttemptsSection");
      if (m.showTimer) {
        timerRow.classList.add("visible");
        timerText.textContent = m.timerLabel || "0:00";
      } else {
        timerRow.classList.remove("visible");
      }
      if (pastSec) {
        pastSec.classList.toggle("hidden-during-run", !!m.hidePastAttempts);
      }
      if (m.showStart) {
        startBtn.classList.remove("hidden");
        startBtn.disabled = false;
      } else {
        startBtn.classList.add("hidden");
      }
      var clickable = !!m.problemsClickable;
      document.querySelectorAll(".prob-row").forEach(function (el) {
        el.classList.toggle("prob-row-disabled", !clickable);
        el.disabled = !clickable;
      });
      if (m.showEndInterview) {
        endBtn.classList.remove("hidden");
      } else {
        endBtn.classList.add("hidden");
      }
    });
  </script>
</body></html>`;
}

export class LeetcodeInterviewEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getProvider: () => IProblemProvider
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const iconUri = vscode.Uri.joinPath(this.context.extensionUri, "icons", "logo-dark-16.png");
    webviewPanel.iconPath = { light: iconUri, dark: iconUri };
    webviewPanel.webview.options = { enableScripts: true, localResourceRoots: [] };

    const postInterviewState = () => {
      const canonicalPath = normalizeInterviewFilePath(document.uri.fsPath);
      const session = getInterviewSession(this.context.globalState);
      const srcPath = session?.sourceLcInterviewPath;
      const activeForThis =
        Boolean(session?.active) &&
        typeof srcPath === "string" &&
        srcPath.trim().length > 0 &&
        normalizeInterviewFilePath(srcPath) === canonicalPath;
      const anyActive = Boolean(session?.active);
      let timerLabel = "0:00";
      if (session && activeForThis) {
        const rm = remainingMs(session);
        const mi = Math.floor(rm / 60_000);
        const se = Math.floor((rm % 60_000) / 1000);
        timerLabel = `${mi}:${se < 10 ? "0" : ""}${se}`;
      }
      void webviewPanel.webview.postMessage({
        type: "interviewState",
        showTimer: activeForThis,
        timerLabel,
        showStart: !anyActive,
        problemsClickable: activeForThis,
        showEndInterview: activeForThis,
        hidePastAttempts: activeForThis,
      });
    };

    const tick = setInterval(postInterviewState, 1000);

    const refresh = async () => {
      const parsed = parseLcInterviewFile(document.getText());
      const fallback = parseLcInterviewFile("");
      const data: LcInterviewFileV1 = parsed.ok
        ? parsed.data
        : fallback.ok
          ? fallback.data
          : {
              version: 1,
              name: defaultInterviewNameFromDate(),
              durationMinutes: 45,
              problems: [],
            };
      const canonicalPath = normalizeInterviewFilePath(document.uri.fsPath);
      const interviewDir = path.join(path.dirname(canonicalPath), sanitizeInterviewDirectoryName(data.name));
      const attempts = data.attempts ?? [];
      const pastAttempts = attempts.map((a) => {
        const absPath = path.join(interviewDir, `report-${a.id}.lcireport`);
        let exists = false;
        try {
          exists = fs.existsSync(absPath);
        } catch {
          exists = false;
        }
        return { id: a.id, time: a.time, absPath, exists };
      });
      const problems = data.problems ?? [];
      const rows: { titleSlug: string; title: string }[] = [];
      for (const p of problems) {
        try {
          const prob = await this.getProvider().getProblem(p.titleSlug);
          rows.push({
            titleSlug: p.titleSlug,
            title: prob?.title ?? formatTitleFromSlug(p.titleSlug),
          });
        } catch {
          rows.push({
            titleSlug: p.titleSlug,
            title: formatTitleFromSlug(p.titleSlug),
          });
        }
      }
      const displayPath = buildInterviewFileDisplayLabel(canonicalPath);
      webviewPanel.webview.html = getWebviewHtml(data, rows, canonicalPath, displayPath, pastAttempts);
      postInterviewState();
    };

    void refresh();

    let refreshDebounce: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (refreshDebounce) clearTimeout(refreshDebounce);
      refreshDebounce = setTimeout(() => {
        refreshDebounce = undefined;
        void refresh();
      }, 320);
    };

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        scheduleRefresh();
      }
    });
    webviewPanel.onDidDispose(() => {
      clearInterval(tick);
      if (refreshDebounce) clearTimeout(refreshDebounce);
      sub.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(
      (msg: {
        type?: string;
        data?: LcInterviewFileV1;
        name?: string;
        durationMinutes?: number;
        titleSlug?: string;
        reportPath?: string;
      }) => {
        if (!msg?.type) return;
        if (msg.type === "saveMeta" && typeof msg.name === "string") {
          const parsed = parseLcInterviewFile(document.getText());
          if (!parsed.ok) return;
          const next: LcInterviewFileV1 = {
            ...parsed.data,
            name: msg.name.trim() || defaultInterviewNameFromDate(),
          };
          const json = serializeLcInterviewFile(next);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), json);
          void vscode.workspace.applyEdit(edit);
          return;
        }
        if (msg.type === "startInterview" && msg.data) {
          const canonicalPath = normalizeInterviewFilePath(document.uri.fsPath);
          void vscode.commands.executeCommand("leetcode-practice.interviewStartFromLcInterviewFile", {
            fsPath: canonicalPath,
            payload: msg.data,
          });
          return;
        }
        if (msg.type === "endInterview") {
          void vscode.commands.executeCommand("leetcode-practice.interviewModeStop");
          return;
        }
        if (msg.type === "openPastReport" && typeof msg.reportPath === "string" && msg.reportPath.trim()) {
          const p = msg.reportPath.trim();
          try {
            void vscode.commands.executeCommand(
              "vscode.openWith",
              vscode.Uri.file(p),
              "leetcode-practice.lcInterviewReportEditor",
              vscode.ViewColumn.One
            );
          } catch {
            /* */
          }
          return;
        }
        if (msg.type === "openProblem" && typeof msg.titleSlug === "string" && msg.titleSlug.trim()) {
          void vscode.commands.executeCommand(
            "leetcode-practice.openInterviewPlanProblem",
            msg.titleSlug.trim()
          );
        }
      }
    );
  }
}
