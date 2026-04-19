import * as vscode from "vscode";
import {
  hasAnalysisContent,
  hasCoachingContent,
  hasStructuredHintContent,
  type HintCurrentRating,
  type HintEfficiencyAxis,
  type LeetcodeHintFileV1,
} from "./HintFile";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape + inline **bold** + `\( ... \)` → monospace (LaTeX-style from JSON strings). */
export function formatDisplayText(s: string): string {
  const segments: string[] = [];
  let last = 0;
  const re = /\\\(([^)]*)\\\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    segments.push(escapeHtml(s.slice(last, m.index)));
    segments.push('<code class="lcx-math">' + escapeHtml(m[1]) + "</code>");
    last = m.index + m[0].length;
  }
  segments.push(escapeHtml(s.slice(last)));
  let t = segments.join("");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return t;
}

function scoreClass(n: number): string {
  if (n >= 7) return "lcx-score-good";
  if (n >= 4) return "lcx-score-mid";
  return "lcx-score-low";
}

function scorePill(label: string, n: number | undefined): string {
  if (n === undefined) return "";
  return `<span class="lcx-score-pill ${scoreClass(n)}" title="1–10 for this problem">${escapeHtml(label)} <strong>${n}</strong>/10</span>`;
}

function rowKv(
  label: string,
  value: string | undefined,
  suggested: boolean,
  currentRating?: HintCurrentRating
): string {
  if (!value?.trim()) return "";
  let cls = "lcx-kv-value";
  if (suggested) {
    cls += " lcx-suggested";
  } else if (label === "Current") {
    const tier = currentRating ?? "avg";
    cls += tier === "worst" ? " lcx-cur-worst" : tier === "good" ? " lcx-cur-good" : " lcx-cur-avg";
  }
  return `<div class="lcx-kv-row"><span class="lcx-kv-label">${escapeHtml(label)}:</span><span class="${cls}">${formatDisplayText(value.trim())}</span></div>`;
}

function sectionBlock(title: string, icon: string, inner: string, scoreHtml?: string): string {
  return `<section class="lcx-section">
    <h2 class="lcx-section-title"><span class="lcx-section-icon" aria-hidden="true">${icon}</span>${escapeHtml(title)}${scoreHtml ?? ""}</h2>
    <div class="lcx-section-body">${inner}</div>
  </section>`;
}

function renderCoaching(data: LeetcodeHintFileV1): string {
  const c = data.coaching;
  if (!c) return '<p class="lcx-muted">No coaching notes yet. Use <strong>Ask agent — Hint</strong> or the Hint button below.</p>';
  const rows: string[] = [];
  const add = (label: string, val: string | undefined) => {
    if (!val?.trim()) return;
    rows.push(
      `<div class="lcx-coach-block"><h3 class="lcx-coach-h">${escapeHtml(label)}</h3><p class="lcx-coach-p">${formatDisplayText(val.trim())}</p></div>`
    );
  };
  add("Problem angle", c.breakdown);
  add("How to think", c.thinking);
  add("Watch out for", c.pitfalls);
  add("Try next", c.nextFocus);
  if (!rows.length) return '<p class="lcx-muted">—</p>';
  return `<div class="lcx-card lcx-coach-card">${rows.join("")}</div>`;
}

function renderApproach(data: LeetcodeHintFileV1): string {
  const a = data.approach;
  if (!a) return '<p class="lcx-muted">—</p>';
  const parts = [
    rowKv("Current", a.current, false, a.currentRating),
    rowKv("Suggested", a.suggested, true),
  ].filter(Boolean);
  let key = "";
  if (a.keyIdea?.trim()) {
    key = `<div class="lcx-key-idea">
      <span class="lcx-key-idea-label">Key idea</span>
      <p class="lcx-key-idea-text">${formatDisplayText(a.keyIdea.trim())}</p>
    </div>`;
  }
  if (parts.length === 0 && !key) return '<p class="lcx-muted">—</p>';
  return `<div class="lcx-card">${parts.join("")}${key}</div>`;
}

function renderEfficiencyAxis(label: string, axis: HintEfficiencyAxis | undefined): string {
  if (!axis) return "";
  const rows = [
    rowKv("Current", axis.current, false, axis.currentRating),
    rowKv("Suggested", axis.suggested, true),
    rowKv("Suggestion", axis.suggestion, false),
  ].filter(Boolean);
  if (!rows.length && axis.score === undefined) return "";
  const score = scorePill("Score", axis.score);
  const head = score ? `<div class="lcx-axis-score">${score}</div>` : "";
  return `<div class="lcx-eff-block"><h3 class="lcx-eff-sub">${escapeHtml(label)}</h3>${head}${rows.join("")}</div>`;
}

function renderEfficiency(data: LeetcodeHintFileV1): string {
  const e = data.efficiency;
  if (!e) return '<p class="lcx-muted">—</p>';
  const time = renderEfficiencyAxis("Time complexity", e.time);
  const space = renderEfficiencyAxis("Space complexity", e.space);
  if (!time && !space) return '<p class="lcx-muted">—</p>';
  return `<div class="lcx-card lcx-eff-card">${time}${space}</div>`;
}

function renderCodeStyle(data: LeetcodeHintFileV1): string {
  const c = data.codeStyle;
  if (!c) return '<p class="lcx-muted">—</p>';
  const pills =
    (c.readabilityScore !== undefined || c.structureScore !== undefined
      ? `<div class="lcx-axis-score">${scorePill("Readability", c.readabilityScore)}${scorePill("Structure", c.structureScore)}</div>`
      : "") + "";
  const rows = [
    rowKv("Readability", c.readability, false),
    rowKv("Structure", c.structure, false),
    rowKv("Suggestions", c.suggestions, false),
  ].filter(Boolean);
  if (!rows.length && !pills) return '<p class="lcx-muted">—</p>';
  return `<div class="lcx-card">${pills}${rows.join("")}</div>`;
}

function buildCoachingHtml(data: LeetcodeHintFileV1): string {
  return sectionBlock("Coaching", "\u2728", renderCoaching(data));
}

function buildAnalysisHtml(data: LeetcodeHintFileV1): string {
  const apScore = data.approach?.score !== undefined ? scorePill("Approach", data.approach.score) : "";
  const approachBlock = sectionBlock(
    "Approach",
    "◇",
    renderApproach(data),
    apScore ? `<span class="lcx-title-scores">${apScore}</span>` : ""
  );
  return [
    approachBlock,
    sectionBlock("Efficiency", "\u26A1", renderEfficiency(data)),
    sectionBlock("Code style", "\u270E", renderCodeStyle(data)),
  ].join("");
}

/** Tabbed Coaching vs Analysis view (structured JSON). */
export function renderHintViewHtml(webview: vscode.Webview, problemLine: string, data: LeetcodeHintFileV1): string {
  const csp = [
    `default-src 'none';`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src 'unsafe-inline';`,
  ].join(" ");

  const coachingMain = buildCoachingHtml(data);
  const analysisMain = buildAnalysisHtml(data);
  const empty = !hasStructuredHintContent(data);
  const showCoach = hasCoachingContent(data);
  const showAnalysis = hasAnalysisContent(data);
  const initialTab = showCoach && !showAnalysis ? "coach" : "analysis";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Solution notes</title>
  <style>
    :root {
      --lcx-bg: var(--vscode-editor-background, #1e1e1e);
      --lcx-card: var(--vscode-sideBar-background, #252526);
      --lcx-text: var(--vscode-editor-foreground, #f9fafb);
      --lcx-muted: var(--vscode-descriptionForeground, #9ca3af);
      --lcx-accent: var(--vscode-textLink-foreground, #9d8df1);
      --lcx-green: var(--vscode-testing-iconPassed, #69db7c);
      --lcx-border: var(--vscode-widget-border, #3a3a45);
      --lcx-code-bg: var(--vscode-textCodeBlock-background, #2d2d30);
      --lcx-btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --lcx-btn-secondary-fg: var(--vscode-button-secondaryForeground, #e0e0e0);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px 20px 28px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 13px;
      line-height: 1.55;
      background: var(--lcx-bg);
      color: var(--lcx-text);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .lcx-subtitle {
      margin: 0 0 14px;
      font-size: 12px;
      color: var(--lcx-muted);
      max-width: 72ch;
    }
    .lcx-intro {
      margin: 0 0 14px;
      font-size: 12px;
      color: var(--lcx-muted);
      max-width: 72ch;
      line-height: 1.45;
    }
    .lcx-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      padding: 4px;
      background: var(--lcx-card);
      border-radius: 10px;
      border: 1px solid var(--lcx-border);
      width: fit-content;
      max-width: 100%;
      flex-wrap: wrap;
    }
    .lcx-tab {
      font-size: 12px;
      font-weight: 600;
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      background: transparent;
      color: var(--lcx-muted);
    }
    .lcx-tab:hover { color: var(--lcx-text); }
    .lcx-tab[aria-selected="true"] {
      background: var(--lcx-bg);
      color: var(--lcx-accent);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .lcx-panel[hidden] { display: none !important; }
    .lcx-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 18px;
      align-items: center;
    }
    button.lcx-btn-secondary {
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--lcx-border);
      background: var(--lcx-btn-secondary-bg);
      color: var(--lcx-btn-secondary-fg);
      cursor: pointer;
      font-family: inherit;
    }
    button.lcx-btn-secondary:hover {
      opacity: 0.92;
    }
    button.lcx-warn {
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid rgba(239, 68, 68, 0.45);
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      cursor: pointer;
      font-family: inherit;
    }
    .lcx-toolbar-hint {
      font-size: 11px;
      color: var(--lcx-muted);
      margin-left: 4px;
      flex: 1 1 180px;
    }
    .lcx-main { display: flex; flex-direction: column; gap: 20px; }
    .lcx-section { margin: 0; }
    .lcx-section-title {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
      color: var(--lcx-accent);
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .lcx-title-scores { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .lcx-section-icon { font-size: 15px; opacity: 0.9; }
    .lcx-score-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid var(--lcx-border);
      white-space: nowrap;
    }
    .lcx-score-pill strong { font-weight: 700; }
    .lcx-score-good { color: var(--lcx-green); border-color: rgba(74, 222, 128, 0.35); }
    .lcx-score-mid { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
    .lcx-score-low { color: #f87171; border-color: rgba(248, 113, 113, 0.35); }
    .lcx-card {
      background: var(--lcx-card);
      border-radius: 12px;
      border: 1px solid var(--lcx-border);
      padding: 14px 16px;
    }
    .lcx-coach-card .lcx-coach-block + .lcx-coach-block {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--lcx-border);
    }
    .lcx-coach-h {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--lcx-muted);
    }
    .lcx-coach-p { margin: 0; line-height: 1.5; }
    .lcx-eff-card .lcx-eff-block + .lcx-eff-block {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--lcx-border);
    }
    .lcx-axis-score {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .lcx-eff-sub {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--lcx-muted);
      text-transform: none;
    }
    .lcx-kv-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px 12px;
      margin: 6px 0;
      font-size: 13px;
    }
    .lcx-kv-label {
      color: var(--lcx-muted);
      min-width: 7.5em;
    }
    .lcx-kv-value { color: var(--lcx-text); }
    .lcx-kv-value.lcx-suggested { color: var(--lcx-green); font-weight: 500; }
    .lcx-kv-value.lcx-cur-worst { color: #f87171; font-weight: 500; }
    .lcx-kv-value.lcx-cur-avg { color: #d1d5db; }
    .lcx-kv-value.lcx-cur-good { color: #4ade80; font-weight: 500; }
    .lcx-key-idea {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--lcx-border);
    }
    .lcx-key-idea-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: var(--lcx-muted);
      margin-bottom: 6px;
    }
    .lcx-key-idea-text { margin: 0; line-height: 1.5; }
    code.lcx-math {
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      font-size: 12px;
      background: var(--lcx-code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--lcx-text);
    }
    .lcx-kv-value.lcx-cur-worst code.lcx-math,
    .lcx-kv-value.lcx-cur-avg code.lcx-math,
    .lcx-kv-value.lcx-cur-good code.lcx-math {
      color: inherit;
      background: rgba(0, 0, 0, 0.15);
    }
    .lcx-muted { color: var(--lcx-muted); }
    strong { font-weight: 600; color: var(--lcx-text); }
    .lcx-empty-hint { font-size: 12px; color: var(--lcx-muted); margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>Solution notes</h1>
  <p class="lcx-subtitle" id="problemLine">${escapeHtml(problemLine)}</p>
  <p class="lcx-intro">Coaching is <strong>short problem-only nudges</strong>—not feedback on your code (use <strong>Analyze</strong> for that). Analysis scores (1–10) rate your <strong>implementation</strong> for this problem; high scores mean you are in good shape.</p>
  <div class="lcx-tabs" role="tablist">
    <button type="button" class="lcx-tab" role="tab" id="tabCoach" aria-controls="panelCoach" aria-selected="false">Coaching</button>
    <button type="button" class="lcx-tab" role="tab" id="tabAnalysis" aria-controls="panelAnalysis" aria-selected="false">Analysis</button>
  </div>
  <div class="lcx-toolbar">
    <button type="button" class="lcx-btn-secondary" id="refreshCoachBtn" title="Clear coaching fields and open the Hint agent">Ask agent — Hint</button>
    <button type="button" class="lcx-warn" id="reanalyzeBtn" title="Clear analysis fields and open the Analyze agent">Ask agent — Analyze</button>
    <span class="lcx-toolbar-hint">Agent fills the <code class="lcx-math">.hint</code> JSON beside your solution.</span>
  </div>
  ${empty ? '<p class="lcx-empty-hint" id="emptyHint">Nothing saved yet. Use the buttons above or run commands from the problem panel.</p>' : ""}
  <div class="lcx-panel" role="tabpanel" id="panelCoach" aria-labelledby="tabCoach" hidden>
    <div class="lcx-main" id="lcxMainCoach">${coachingMain}</div>
  </div>
  <div class="lcx-panel" role="tabpanel" id="panelAnalysis" aria-labelledby="tabAnalysis" hidden>
    <div class="lcx-main" id="lcxMainAnalysis">${analysisMain}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const tabCoach = document.getElementById("tabCoach");
    const tabAnalysis = document.getElementById("tabAnalysis");
    const panelCoach = document.getElementById("panelCoach");
    const panelAnalysis = document.getElementById("panelAnalysis");
    function setTab(which) {
      const coach = which === "coach";
      tabCoach.setAttribute("aria-selected", coach ? "true" : "false");
      tabAnalysis.setAttribute("aria-selected", coach ? "false" : "true");
      panelCoach.hidden = !coach;
      panelAnalysis.hidden = coach;
    }
    tabCoach.addEventListener("click", function () { setTab("coach"); });
    tabAnalysis.addEventListener("click", function () { setTab("analysis"); });
    setTab(${JSON.stringify(initialTab)});
    document.getElementById("refreshCoachBtn").addEventListener("click", function () {
      vscode.postMessage({ type: "refreshCoaching" });
    });
    document.getElementById("reanalyzeBtn").addEventListener("click", function () {
      vscode.postMessage({ type: "reanalyze" });
    });
  </script>
</body>
</html>`;
}
