import * as vscode from "vscode";
import type { LeetcodeConfig } from "./LeetcodeConfig";

const DEFAULTS: LeetcodeConfig = {
  studyPlans: [{ slug: "top-interview-150", name: "Top Interview 150" }],
  activeStudyPlan: undefined,
  theme: "auto",
  defaultDirectory: ".",
  fileNamePattern: "id",
  language: "typescript",
  internalApiUrl: "",
  showProblemset: true,
  showStudyPlans: true,
  showQotd: true,
  qotdMonths: 6,
};

function parseConfig(text: string): LeetcodeConfig {
  const trimmed = text.trim();
  if (!trimmed) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const config: LeetcodeConfig = { ...DEFAULTS };
    if (Array.isArray(parsed.studyPlans)) {
      config.studyPlans = parsed.studyPlans.filter(
        (p: unknown): p is { slug: string; name: string } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { slug?: unknown }).slug === "string" &&
          typeof (p as { name?: unknown }).name === "string"
      );
      if (config.studyPlans.length === 0) config.studyPlans = DEFAULTS.studyPlans;
    }
    if (typeof parsed.activeStudyPlan === "string") config.activeStudyPlan = parsed.activeStudyPlan;
    if (["auto", "leetcode-dark", "none"].includes(String(parsed.theme))) {
      config.theme = parsed.theme as LeetcodeConfig["theme"];
    }
    if (typeof parsed.defaultDirectory === "string") config.defaultDirectory = parsed.defaultDirectory;
    if (["id", "slug"].includes(String(parsed.fileNamePattern))) {
      config.fileNamePattern = parsed.fileNamePattern as "id" | "slug";
    }
    if (["typescript", "javascript", "python"].includes(String(parsed.language))) {
      config.language = parsed.language as "typescript" | "javascript" | "python";
    }
    if (typeof parsed.showProblemset === "boolean") config.showProblemset = parsed.showProblemset;
    if (typeof parsed.showStudyPlans === "boolean") config.showStudyPlans = parsed.showStudyPlans;
    if (typeof parsed.showQotd === "boolean") config.showQotd = parsed.showQotd;
    if (typeof parsed.qotdMonths === "number" && parsed.qotdMonths >= 1) config.qotdMonths = parsed.qotdMonths;
    if (typeof parsed.internalApiUrl === "string") config.internalApiUrl = parsed.internalApiUrl;
    if (typeof parsed.agentPromptMakeRunnable === "string") config.agentPromptMakeRunnable = parsed.agentPromptMakeRunnable;
    if (typeof parsed.agentPromptHint === "string") config.agentPromptHint = parsed.agentPromptHint;
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

function configToJson(config: LeetcodeConfig): string {
  return JSON.stringify(config, null, 2);
}

function getWebviewContent(config: LeetcodeConfig, webview: vscode.Webview): string {
  const studyPlans = config.studyPlans ?? DEFAULTS.studyPlans!;
  const plansHtml = studyPlans
    .map(
      (p, i) => `
      <div class="plan-row" data-index="${i}">
        <input type="text" class="plan-slug" value="${escapeHtml(p.slug)}" placeholder="e.g. top-interview-150" />
        <input type="text" class="plan-name" value="${escapeHtml(p.name)}" placeholder="Display name" />
        <button class="btn-remove" data-index="${i}" title="Remove">×</button>
      </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LeetCode Config</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 12px 0;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h2::before {
      content: '';
      width: 4px;
      height: 16px;
      background: #FFA116;
      border-radius: 2px;
    }
    .section {
      margin-bottom: 24px;
    }
    .section:last-child { margin-bottom: 0; }
    .field {
      margin-bottom: 12px;
    }
    .field label {
      display: block;
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    select, input[type="text"], input[type="number"] {
      width: 100%;
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 13px;
    }
    select:focus, input:focus {
      outline: none;
      border-color: #FFA116;
    }
    .plan-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }
    .plan-row input { margin: 0; }
    .btn-remove {
      width: 32px;
      height: 32px;
      padding: 0;
      background: transparent;
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-foreground);
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .btn-remove:hover {
      background: var(--vscode-button-hoverBackground, #333);
      border-color: #FFA116;
      color: #FFA116;
    }
    .btn-add {
      padding: 8px 16px;
      background: #FFA116;
      color: #1A1A1A;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      margin-top: 4px;
    }
    .btn-add:hover { background: #FFB84D; }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .toggle-row:last-child { border-bottom: none; }
    .toggle-row label { margin: 0; }
  </style>
</head>
<body>
  <div class="section">
    <h2>Study Plans</h2>
    <div class="field">
      <label>Active study plan (default when opening workspace)</label>
      <select id="activeStudyPlan">
        <option value="">First in list</option>
        ${studyPlans.map((p) => `<option value="${escapeHtml(p.slug)}" ${config.activeStudyPlan === p.slug ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      </select>
    </div>
    <div id="plans-container">${plansHtml}</div>
    <button class="btn-add" id="add-plan">+ Add Study Plan</button>
  </div>
  <div class="section">
    <h2>Appearance</h2>
    <div class="field">
      <label>Theme</label>
      <select id="theme">
        <option value="auto" ${config.theme === "auto" ? "selected" : ""}>Auto (LeetCode Dark when .leetcode exists)</option>
        <option value="leetcode-dark" ${config.theme === "leetcode-dark" ? "selected" : ""}>Always LeetCode Dark</option>
        <option value="none" ${config.theme === "none" ? "selected" : ""}>None (don't change theme)</option>
      </select>
    </div>
  </div>
  <div class="section">
    <h2>API</h2>
    <div class="field">
      <label>Internal API URL (optional)</label>
      <input type="text" id="internalApiUrl" value="${escapeHtml(config.internalApiUrl ?? "")}" placeholder="https://internal-api.example.com" />
    </div>
  </div>
  <div class="section">
    <h2>Files & Language</h2>
    <div class="field">
      <label>Default directory for new problems</label>
      <input type="text" id="defaultDirectory" value="${escapeHtml(config.defaultDirectory ?? ".")}" placeholder="." />
    </div>
    <div class="field">
      <label>File name pattern</label>
      <select id="fileNamePattern">
        <option value="id" ${config.fileNamePattern === "id" ? "selected" : ""}>ID (e.g. 167.ts)</option>
        <option value="slug" ${config.fileNamePattern === "slug" ? "selected" : ""}>Slug (e.g. two-sum.ts)</option>
      </select>
    </div>
    <div class="field">
      <label>Language</label>
      <select id="language">
        <option value="typescript" ${config.language === "typescript" ? "selected" : ""}>TypeScript</option>
        <option value="javascript" ${config.language === "javascript" ? "selected" : ""}>JavaScript</option>
        <option value="python" ${config.language === "python" ? "selected" : ""}>Python</option>
      </select>
    </div>
  </div>
  <div class="section">
    <h2>Agent prompts (solution file toolbar)</h2>
    <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 12px 0;">When a .ts, .js, or .py file is open in a LeetCode workspace, toolbar buttons open Cursor chat with these prompts. Edit in .leetcode to customize.</p>
    <div class="field">
      <label>Make runnable button</label>
      <input type="text" id="agentPromptMakeRunnable" value="${escapeHtml(config.agentPromptMakeRunnable ?? "Make this Runnable, do not give solution.")}" placeholder="Make this Runnable, do not give solution." />
    </div>
    <div class="field">
      <label>Hint button</label>
      <input type="text" id="agentPromptHint" value="${escapeHtml(config.agentPromptHint ?? "Give me a hint for this problem. Do not give the solution.")}" placeholder="Give me a hint. Do not give the solution." />
    </div>
  </div>
  <div class="section">
    <h2>Views</h2>
    <div class="toggle-row">
      <label>Show Problemset view</label>
      <input type="checkbox" id="showProblemset" ${config.showProblemset !== false ? "checked" : ""} />
    </div>
    <div class="toggle-row">
      <label>Show Study Plans view</label>
      <input type="checkbox" id="showStudyPlans" ${config.showStudyPlans !== false ? "checked" : ""} />
    </div>
    <div class="toggle-row">
      <label>Show Question of the Day</label>
      <input type="checkbox" id="showQotd" ${config.showQotd !== false ? "checked" : ""} />
    </div>
    <div class="field">
      <label>QOTD cache (months)</label>
      <input type="number" id="qotdMonths" value="${config.qotdMonths ?? 6}" min="1" max="24" />
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function escapeHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function collectConfig() {
      const plans = [];
      document.querySelectorAll('.plan-row').forEach(row => {
        const slug = row.querySelector('.plan-slug').value.trim();
        const name = row.querySelector('.plan-name').value.trim();
        if (slug && name) plans.push({ slug, name });
      });
      if (plans.length === 0) plans.push({ slug: 'top-interview-150', name: 'Top Interview 150' });
      const activeEl = document.getElementById('activeStudyPlan');
      return {
        studyPlans: plans,
        activeStudyPlan: activeEl?.value?.trim() || undefined,
        theme: document.getElementById('theme').value,
        defaultDirectory: document.getElementById('defaultDirectory').value.trim() || '.',
        fileNamePattern: document.getElementById('fileNamePattern').value,
        language: document.getElementById('language').value,
        internalApiUrl: document.getElementById('internalApiUrl').value.trim(),
        showProblemset: document.getElementById('showProblemset').checked,
        showStudyPlans: document.getElementById('showStudyPlans').checked,
        showQotd: document.getElementById('showQotd').checked,
        qotdMonths: Math.max(1, parseInt(document.getElementById('qotdMonths').value, 10) || 6),
        agentPromptMakeRunnable: document.getElementById('agentPromptMakeRunnable').value.trim() || undefined,
        agentPromptHint: document.getElementById('agentPromptHint').value.trim() || undefined
      };
    }
    function notifyChange() { vscode.postMessage({ type: 'update', config: collectConfig() }); }
    document.getElementById('add-plan').onclick = () => {
      const container = document.getElementById('plans-container');
      const idx = container.querySelectorAll('.plan-row').length;
      const div = document.createElement('div');
      div.className = 'plan-row';
      div.dataset.index = String(idx);
      div.innerHTML = '<input type="text" class="plan-slug" placeholder="e.g. top-interview-150" /><input type="text" class="plan-name" placeholder="Display name" /><button class="btn-remove" title="Remove">×</button>';
      div.querySelector('.btn-remove').onclick = () => { div.remove(); notifyChange(); };
      div.querySelectorAll('input').forEach(i => i.oninput = notifyChange);
      container.appendChild(div);
      notifyChange();
    };
    document.querySelectorAll('.plan-row').forEach(row => {
      row.querySelector('.btn-remove').onclick = () => { row.remove(); notifyChange(); };
      row.querySelectorAll('input').forEach(i => i.oninput = notifyChange);
    });
    document.querySelectorAll('select, input[type="number"]').forEach(el => el.onchange = notifyChange);
    document.querySelectorAll('input[type="checkbox"]').forEach(el => el.onchange = notifyChange);
    document.getElementById('defaultDirectory').oninput = notifyChange;
    document.getElementById('internalApiUrl').oninput = notifyChange;
    document.getElementById('agentPromptMakeRunnable').oninput = notifyChange;
    document.getElementById('agentPromptHint').oninput = notifyChange;
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class LeetcodeConfigEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    const updateWebview = () => {
      const config = parseConfig(document.getText());
      webviewPanel.webview.html = getWebviewContent(config, webviewPanel.webview);
    };

    updateWebview();

    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "update" && msg.config) {
        const json = configToJson(msg.config as LeetcodeConfig);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), json);
        vscode.workspace.applyEdit(edit);
      }
    });
  }
}
