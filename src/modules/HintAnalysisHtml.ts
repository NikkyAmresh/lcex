import * as vscode from "vscode";
import {
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

function sectionBlock(title: string, icon: string, inner: string): string {
  return `<section class="lcx-section">
    <h2 class="lcx-section-title"><span class="lcx-section-icon" aria-hidden="true">${icon}</span>${escapeHtml(title)}</h2>
    <div class="lcx-section-body">${inner}</div>
  </section>`;
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
  if (!rows.length) return "";
  return `<div class="lcx-eff-block"><h3 class="lcx-eff-sub">${escapeHtml(label)}</h3>${rows.join("")}</div>`;
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
  const rows = [
    rowKv("Readability", c.readability, false),
    rowKv("Structure", c.structure, false),
    rowKv("Suggestions", c.suggestions, false),
  ].filter(Boolean);
  if (!rows.length) return '<p class="lcx-muted">—</p>';
  return `<div class="lcx-card">${rows.join("")}</div>`;
}

function buildMainHtml(data: LeetcodeHintFileV1): string {
  return [
    sectionBlock("Approach", "◇", renderApproach(data)),
    sectionBlock("Efficiency", "⚡", renderEfficiency(data)),
    sectionBlock("Code style", "✎", renderCodeStyle(data)),
  ].join("");
}

/** Single-scroll Analysis view (structured JSON only). */
export function renderHintViewHtml(webview: vscode.Webview, problemLine: string, data: LeetcodeHintFileV1): string {
  const csp = [
    `default-src 'none';`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src 'unsafe-inline';`,
  ].join(" ");

  const main = buildMainHtml(data);
  const empty = !hasStructuredHintContent(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hint analysis</title>
  <style>
    :root {
      --lcx-bg: #1e1e1e;
      --lcx-card: #262630;
      --lcx-text: #f9fafb;
      --lcx-muted: #9ca3af;
      --lcx-purple: #9d8df1;
      --lcx-green: #69db7c;
      --lcx-border: #3a3a45;
      --lcx-code-bg: #2d2d30;
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
      max-width: 60ch;
    }
    .lcx-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 18px;
    }
    button.lcx-warn {
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      cursor: pointer;
      font-family: inherit;
    }
    .lcx-main { display: flex; flex-direction: column; gap: 20px; }
    .lcx-section { margin: 0; }
    .lcx-section-title {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
      color: var(--lcx-purple);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .lcx-section-icon { font-size: 15px; opacity: 0.9; }
    .lcx-card {
      background: var(--lcx-card);
      border-radius: 12px;
      border: 1px solid rgba(58, 58, 69, 0.9);
      padding: 14px 16px;
    }
    .lcx-eff-card .lcx-eff-block + .lcx-eff-block {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid rgba(58, 58, 69, 0.75);
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
      border-top: 1px solid rgba(58, 58, 69, 0.75);
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
      background: rgba(0, 0, 0, 0.22);
    }
    .lcx-muted { color: var(--lcx-muted); }
    strong { font-weight: 600; color: var(--lcx-text); }
    .lcx-empty-hint { font-size: 12px; color: var(--lcx-muted); margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>Analysis</h1>
  <p class="lcx-subtitle" id="problemLine">${escapeHtml(problemLine)}</p>
  <div class="lcx-toolbar">
    <button type="button" class="lcx-warn" id="reanalyzeBtn">Re-analyze</button>
  </div>
  ${empty ? '<p class="lcx-empty-hint" id="emptyHint">No hint content yet. Use Re-analyze to ask the agent.</p>' : ""}
  <div class="lcx-main" id="lcxMain">${main}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("reanalyzeBtn").addEventListener("click", function () {
      vscode.postMessage({ type: "reanalyze" });
    });
  </script>
</body>
</html>`;
}
