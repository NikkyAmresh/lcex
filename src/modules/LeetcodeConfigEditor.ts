import * as vscode from "vscode";
import { isSupportedLanguage, type SupportedLanguage } from "./interface/Problem";
import { LANGUAGE_CHOICES } from "./language/LanguageStrategy";
import type { LeetcodeConfig } from "./LeetcodeConfig";

const DEFAULTS: LeetcodeConfig = {
  studyPlans: [{ slug: "top-interview-150", name: "Top Interview 150" }],
  problemLists: [],
  activeStudyPlan: undefined,
  activeProblemList: undefined,
  theme: "auto",
  defaultDirectory: ".",
  fileNamePattern: "id",
  language: "typescript",
  internalApiUrl: "",
  showProblemset: true,
  showStudyPlans: true,
  showProblemLists: true,
  showQotd: true,
  qotdMonths: 6,
  problemViewMode: "ui",
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
    if (Array.isArray(parsed.problemLists)) {
      config.problemLists = parsed.problemLists.filter(
        (p: unknown): p is { slug: string; name: string } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { slug?: unknown }).slug === "string" &&
          typeof (p as { name?: unknown }).name === "string"
      );
    }
    if (typeof parsed.activeStudyPlan === "string") config.activeStudyPlan = parsed.activeStudyPlan;
    if (typeof parsed.activeProblemList === "string") config.activeProblemList = parsed.activeProblemList;
    if (parsed.activeListSource === "studyPlan" || parsed.activeListSource === "problemList") {
      config.activeListSource = parsed.activeListSource;
    }
    if (["auto", "leetcode-dark", "none"].includes(String(parsed.theme))) {
      config.theme = parsed.theme as LeetcodeConfig["theme"];
    }
    if (typeof parsed.defaultDirectory === "string") config.defaultDirectory = parsed.defaultDirectory;
    if (["id", "slug"].includes(String(parsed.fileNamePattern))) {
      config.fileNamePattern = parsed.fileNamePattern as "id" | "slug";
    }
    if (parsed.language !== undefined && isSupportedLanguage(String(parsed.language))) {
      config.language = parsed.language as SupportedLanguage;
    }
    if (typeof parsed.showProblemset === "boolean") config.showProblemset = parsed.showProblemset;
    if (typeof parsed.showStudyPlans === "boolean") config.showStudyPlans = parsed.showStudyPlans;
    if (typeof parsed.showProblemLists === "boolean") config.showProblemLists = parsed.showProblemLists;
    if (typeof parsed.showQotd === "boolean") config.showQotd = parsed.showQotd;
    if (typeof parsed.qotdMonths === "number" && parsed.qotdMonths >= 1) config.qotdMonths = parsed.qotdMonths;
    if (typeof parsed.internalApiUrl === "string") config.internalApiUrl = parsed.internalApiUrl;
    if (typeof parsed.agentPromptMakeRunnable === "string") config.agentPromptMakeRunnable = parsed.agentPromptMakeRunnable;
    if (typeof parsed.agentPromptHint === "string") config.agentPromptHint = parsed.agentPromptHint;
    if (typeof parsed.agentPromptAnalyze === "string") config.agentPromptAnalyze = parsed.agentPromptAnalyze;
    if (typeof parsed.agentPromptExplain === "string") config.agentPromptExplain = parsed.agentPromptExplain;
    if (parsed.problemViewMode === "ui" || parsed.problemViewMode === "text") {
      config.problemViewMode = parsed.problemViewMode;
    }
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
  const problemLists = config.problemLists ?? [];
  const problemListsHtml = problemLists
    .map(
      (p, i) => `
      <div class="list-row" data-index="${i}">
        <input type="text" class="list-slug" value="${escapeHtml(p.slug)}" placeholder="e.g. graph" />
        <input type="text" class="list-name" value="${escapeHtml(p.name)}" placeholder="Display name" />
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
    .plan-row, .list-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }
    .plan-row input, .list-row input { margin: 0; }
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
    <div id="plans-container">${plansHtml}</div>
    <button class="btn-add" id="add-plan">+ Add Study Plan</button>
    <div class="field">
      <label>Default study plan (Study Plans sidebar)</label>
      <select id="activeStudyPlan">
        <option value="">First in list</option>
        ${studyPlans.map((p) => `<option value="${escapeHtml(p.slug)}" ${config.activeStudyPlan === p.slug ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="section">
    <h2>Problem lists</h2>
    <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 12px 0;">LeetCode problem-list slugs (URL <code>/problem-list/&lt;slug&gt;/</code>, e.g. <code>graph</code>). Shown in the Problem Lists sidebar.</p>
    <div id="problem-lists-container">${problemListsHtml}</div>
    <button class="btn-add" id="add-problem-list">+ Add Problem List</button>
    <div class="field">
      <label>Default problem list (Problem Lists sidebar)</label>
      <select id="activeProblemList">
        <option value="">First in list</option>
        ${problemLists.map((p) => `<option value="${escapeHtml(p.slug)}" ${config.activeProblemList === p.slug ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      </select>
    </div>
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
        ${LANGUAGE_CHOICES.map(
          ({ id, label }) =>
            `<option value="${id}" ${config.language === id ? "selected" : ""}>${escapeHtml(label)}</option>`
        ).join("\n        ")}
      </select>
    </div>
  </div>
  <div class="section">
    <h2>Agent prompts (solution file toolbar)</h2>
    <p style="color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 12px 0;">When a solution file (.ts, .js, .py, .cpp, .java) is open in a LeetCode workspace, toolbar buttons open Cursor chat with these prompts. Edit in .leetcode to customize.</p>
    <div class="field">
      <label>Make runnable button</label>
      <input type="text" id="agentPromptMakeRunnable" value="${escapeHtml(config.agentPromptMakeRunnable ?? "Make this Runnable, do not give solution.")}" placeholder="Make this Runnable, do not give solution." />
    </div>
    <div class="field">
      <label>Hint button (coaching)</label>
      <input type="text" id="agentPromptHint" value="${escapeHtml(config.agentPromptHint ?? "Load **lcex-dsa-hint** and follow it. Nudge from the problem only—do not read or review my code. Each `coaching` value: one short line; no solution.")}" placeholder="lcex-dsa-hint; problem-only; no code review; one line per field." />
    </div>
    <div class="field">
      <label>Analyze button (scored review)</label>
      <input type="text" id="agentPromptAnalyze" value="${escapeHtml(config.agentPromptAnalyze ?? "Load **lcex-dsa-analyze** and follow it. Analyze my current LeetCode solution implementation.")}" placeholder="Load lcex-dsa-analyze; fills Analysis in .hint JSON." />
    </div>
    <div class="field">
      <label>Explain selection (base prompt)</label>
      <input type="text" id="agentPromptExplain" value="${escapeHtml(config.agentPromptExplain ?? "")}" placeholder="Explain my code: intuition, dry run, complexity…" style="width:100%;" />
    </div>
  </div>
  <div class="section">
    <h2>Views</h2>
    <div class="field">
      <label>Open problem from sidebar (Problemset / Study plans / Lists / QOTD)</label>
      <select id="problemViewMode">
        <option value="ui" ${(config.problemViewMode ?? "ui") === "ui" ? "selected" : ""}>UI — webview (run, submit, notes)</option>
        <option value="text" ${config.problemViewMode === "text" ? "selected" : ""}>Plain text — statement only (editor tab)</option>
      </select>
    </div>
    <div class="toggle-row">
      <label>Show Problemset view</label>
      <input type="checkbox" id="showProblemset" ${config.showProblemset !== false ? "checked" : ""} />
    </div>
    <div class="toggle-row">
      <label>Show Study Plans view</label>
      <input type="checkbox" id="showStudyPlans" ${config.showStudyPlans !== false ? "checked" : ""} />
    </div>
    <div class="toggle-row">
      <label>Show Problem Lists sidebar</label>
      <input type="checkbox" id="showProblemLists" ${config.showProblemLists !== false ? "checked" : ""} />
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
      const problemLists = [];
      document.querySelectorAll('.list-row').forEach(row => {
        const slug = row.querySelector('.list-slug').value.trim();
        const name = row.querySelector('.list-name').value.trim();
        if (slug && name) problemLists.push({ slug, name });
      });
      return {
        studyPlans: plans,
        problemLists,
        activeStudyPlan: document.getElementById('activeStudyPlan')?.value?.trim() || undefined,
        activeProblemList: document.getElementById('activeProblemList')?.value?.trim() || undefined,
        theme: document.getElementById('theme').value,
        defaultDirectory: document.getElementById('defaultDirectory').value.trim() || '.',
        fileNamePattern: document.getElementById('fileNamePattern').value,
        language: document.getElementById('language').value,
        internalApiUrl: document.getElementById('internalApiUrl').value.trim(),
        showProblemset: document.getElementById('showProblemset').checked,
        showStudyPlans: document.getElementById('showStudyPlans').checked,
        showProblemLists: document.getElementById('showProblemLists').checked,
        showQotd: document.getElementById('showQotd').checked,
        qotdMonths: Math.max(1, parseInt(document.getElementById('qotdMonths').value, 10) || 6),
        agentPromptMakeRunnable: document.getElementById('agentPromptMakeRunnable').value.trim() || undefined,
        agentPromptHint: document.getElementById('agentPromptHint').value.trim() || undefined,
        agentPromptAnalyze: document.getElementById('agentPromptAnalyze').value.trim() || undefined,
        agentPromptExplain: document.getElementById('agentPromptExplain').value.trim() || undefined,
        problemViewMode: document.getElementById('problemViewMode').value === 'text' ? 'text' : 'ui'
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
    document.getElementById('add-problem-list').onclick = () => {
      const container = document.getElementById('problem-lists-container');
      const div = document.createElement('div');
      div.className = 'list-row';
      div.innerHTML = '<input type="text" class="list-slug" placeholder="e.g. graph" /><input type="text" class="list-name" placeholder="Display name" /><button class="btn-remove" title="Remove">×</button>';
      div.querySelector('.btn-remove').onclick = () => { div.remove(); notifyChange(); };
      div.querySelectorAll('input').forEach(i => i.oninput = notifyChange);
      container.appendChild(div);
      notifyChange();
    };
    document.querySelectorAll('.list-row').forEach(row => {
      row.querySelector('.btn-remove').onclick = () => { row.remove(); notifyChange(); };
      row.querySelectorAll('input').forEach(i => i.oninput = notifyChange);
    });
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
    document.getElementById('agentPromptAnalyze').oninput = notifyChange;
    document.getElementById('agentPromptExplain').oninput = notifyChange;
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
