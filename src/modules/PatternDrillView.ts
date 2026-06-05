import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { IProblemProvider } from "./interface/Problem";
import type { ProblemListItem } from "./LeetCode";
import {
  DRILL_TIMEOUT_MS,
  buildDrillQuestion,
  drillStats,
  pickRandomDrillItem,
  readPatternDrillState,
  recordDrillResult,
  type DrillGrade,
  type DrillQuestion,
  type PatternDrillStats,
} from "./PatternDrill";

const DRILL_GRADES: readonly DrillGrade[] = ["full", "partial", "miss"];

let drillPanel: vscode.WebviewPanel | null = null;

interface DrillDeps {
  getProvider: () => IProblemProvider;
  loadItems: () => Promise<ProblemListItem[]>;
  /** Opens the actual problem so a curious user can go solve it. */
  openProblem: (titleSlug: string) => Promise<void>;
}

function nonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Picks a random drillable problem, fetches it, and builds a question. */
async function nextQuestion(deps: DrillDeps, prevSlug?: string): Promise<DrillQuestion | null> {
  const items = await deps.loadItems();
  // Try a few times in case a picked problem fails to fetch / has no tags.
  let avoid = prevSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const item = pickRandomDrillItem(items, avoid);
    if (!item) return null;
    const problem = await deps.getProvider().getProblem(item.titleSlug);
    if (problem) {
      const q = buildDrillQuestion(problem, item);
      if (q) return q;
    }
    avoid = item.titleSlug;
  }
  return null;
}

export async function openPatternDrillWebview(
  context: vscode.ExtensionContext,
  deps: DrillDeps,
): Promise<void> {
  if (drillPanel) {
    try {
      drillPanel.reveal(drillPanel.viewColumn ?? vscode.ViewColumn.One);
      return;
    } catch {
      drillPanel = null;
    }
  }

  const panel = vscode.window.createWebviewPanel(
    "leetcodePatternDrill",
    "Pattern Drill",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true } as vscode.WebviewPanelOptions,
  );
  drillPanel = panel;
  panel.onDidDispose(() => {
    if (drillPanel === panel) drillPanel = null;
  });

  const stats = drillStats(readPatternDrillState(context.globalState));
  panel.webview.html = renderShell(panel.webview, stats);

  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const m = raw as
      | { type: "ready"; prevSlug?: string }
      | { type: "next"; prevSlug?: string }
      | { type: "grade"; patternIds?: string[]; grade?: string }
      | { type: "solve"; titleSlug?: string };
    if (!m || typeof m !== "object") return;

    if (m.type === "solve" && typeof m.titleSlug === "string" && m.titleSlug) {
      await deps.openProblem(m.titleSlug);
      return;
    }

    if (m.type === "ready" || m.type === "next") {
      const q = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading drill problem…" },
        () => nextQuestion(deps, m.prevSlug),
      );
      try {
        if (q) {
          await panel.webview.postMessage({ type: "question", question: q });
        } else {
          await panel.webview.postMessage({ type: "empty" });
        }
      } catch {
        /* panel disposed mid-await */
      }
      return;
    }

    if (m.type === "grade" && Array.isArray(m.patternIds)) {
      const grade: DrillGrade = DRILL_GRADES.includes(m.grade as DrillGrade)
        ? (m.grade as DrillGrade)
        : "miss";
      const updated: PatternDrillStats = await recordDrillResult(
        context.globalState,
        m.patternIds as never[],
        grade,
      );
      try {
        await panel.webview.postMessage({ type: "stats", stats: updated });
      } catch {
        /* panel disposed mid-await */
      }
    }
  });
}

function renderShell(webview: vscode.Webview, stats: PatternDrillStats): string {
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `img-src ${webview.cspSource} https: data:`,
  ].join("; ");
  const timeoutSec = Math.round(DRILL_TIMEOUT_MS / 1000);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Pattern Drill</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 0 24px 32px;
    line-height: 1.5;
  }
  header {
    position: sticky; top: 0;
    background: var(--vscode-editor-background);
    padding: 16px 0 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    z-index: 1;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .stat { font-size: 12px; opacity: .85; }
  .stat b { font-variant-numeric: tabular-nums; }
  #timer { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 13px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
  #timer.urgent { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  .title { font-size: 18px; font-weight: 600; margin: 20px 0 4px; }
  .prompt { margin: 14px 0; padding: 10px 14px; border-left: 3px solid var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); font-size: 13px; }
  .statement { margin-top: 16px; font-size: 14px; }
  .statement pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 6px; overflow-x: auto; }
  .answers { margin-top: 18px; }
  .answer { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; margin: 6px 0; border: 1px solid var(--vscode-panel-border); border-radius: 8px; }
  .answer .icon { font-size: 16px; width: 22px; text-align: center; }
  .answer .label { font-weight: 600; }
  .answer .blurb { opacity: .8; font-size: 12px; }
  .row { margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap; }
  button {
    font-family: inherit; font-size: 13px; cursor: pointer;
    border: none; border-radius: 6px; padding: 8px 16px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .hidden { display: none; }
  .muted { opacity: .7; font-size: 12px; margin-top: 10px; }
  #empty { margin-top: 40px; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>🧩 Pattern Drill</h1>
  <span class="stat">Accuracy <b id="acc">${stats.accuracyPct}%</b></span>
  <span class="stat">Solved <b id="solved">${stats.totalCorrect}/${stats.totalAsked}</b></span>
  <span class="stat">Partial <b id="partial">${stats.totalPartial}</b></span>
  <span class="stat">Streak <b id="streak">${stats.currentStreak}</b> (best <b id="best">${stats.bestStreak}</b>)</span>
  <span id="timer">5:00</span>
</header>

<main>
  <div id="loading" class="muted">Loading…</div>

  <div id="empty" class="hidden">
    No drillable problems found. The Pattern Drill needs the default LeetCode source
    (problems must carry topic tags). Leave <code>internalApiUrl</code> empty and refresh problems.
  </div>

  <div id="question" class="hidden">
    <div class="title" id="q-title"></div>
    <div class="prompt">Read the statement and decide: <b>which algorithmic pattern would you reach for?</b> Think it through, then reveal the answer.</div>
    <div class="statement" id="q-statement"></div>

    <div class="row" id="recall-row">
      <button id="reveal-btn">Reveal pattern</button>
      <button id="solve-btn" class="secondary">Solve this →</button>
      <button id="skip-btn" class="secondary">Skip</button>
    </div>

    <div id="answer-block" class="hidden">
      <div class="answers" id="q-answers"></div>
      <div class="muted" id="grade-prompt">How did you do?</div>
      <div class="row">
        <button id="got-btn">✓ Got it</button>
        <button id="partial-btn" class="secondary hidden">◐ Got some</button>
        <button id="missed-btn" class="secondary">✗ Missed it</button>
      </div>
    </div>

    <div id="next-block" class="row hidden">
      <button id="next-btn">Next problem →</button>
    </div>
  </div>
</main>

<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const TIMEOUT_SEC = ${timeoutSec};
  let current = null;        // current DrillQuestion
  let revealed = false;
  let timerId = null;
  let remaining = TIMEOUT_SEC;

  const $ = (id) => document.getElementById(id);

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function startTimer() {
    stopTimer();
    remaining = TIMEOUT_SEC;
    $('timer').textContent = fmt(remaining);
    $('timer').classList.remove('urgent');
    timerId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 30) $('timer').classList.add('urgent');
      if (remaining <= 0) {
        $('timer').textContent = '0:00';
        stopTimer();
        if (!revealed) reveal();
        return;
      }
      $('timer').textContent = fmt(remaining);
    }, 1000);
  }

  function renderQuestion(q) {
    current = q;
    revealed = false;
    hide('loading'); hide('empty'); hide('answer-block'); hide('next-block');
    show('question'); show('recall-row');
    $('q-title').textContent = q.title || q.titleSlug;
    $('q-statement').innerHTML = q.statementHtml || '<em>(no statement available)</em>';
    $('q-answers').innerHTML = q.answers.map((a) =>
      '<div class="answer"><span class="icon">' + a.icon + '</span>' +
      '<span><span class="label">' + a.label + '</span> ' +
      '<span class="blurb">— ' + a.blurb + '</span></span></div>'
    ).join('');
    // "Got some" only makes sense when more than one distinct pattern is required.
    const multi = (q.patternCount || 0) > 1;
    if (multi) show('partial-btn'); else hide('partial-btn');
    $('grade-prompt').textContent = multi
      ? 'How did you do? (◐ if you named at least one but not all)'
      : 'How did you do?';
    startTimer();
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    stopTimer();
    hide('recall-row');
    show('answer-block');
  }

  function grade(g) {
    if (!current) return;
    vscode.postMessage({ type: 'grade', patternIds: current.answers.map((a) => a.id), grade: g });
    hide('answer-block');
    show('next-block');
  }

  function requestNext() {
    const prev = current ? current.titleSlug : undefined;
    current = null;
    stopTimer();
    hide('question'); show('loading');
    vscode.postMessage({ type: 'next', prevSlug: prev });
  }

  function solveCurrent() {
    if (!current || !current.titleSlug) return;
    vscode.postMessage({ type: 'solve', titleSlug: current.titleSlug });
  }

  $('reveal-btn').addEventListener('click', reveal);
  $('solve-btn').addEventListener('click', solveCurrent);
  $('skip-btn').addEventListener('click', requestNext);
  $('got-btn').addEventListener('click', () => grade('full'));
  $('partial-btn').addEventListener('click', () => grade('partial'));
  $('missed-btn').addEventListener('click', () => grade('miss'));
  $('next-btn').addEventListener('click', requestNext);

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m) return;
    if (m.type === 'question') { renderQuestion(m.question); }
    else if (m.type === 'empty') { stopTimer(); hide('loading'); hide('question'); show('empty'); }
    else if (m.type === 'stats') {
      $('acc').textContent = m.stats.accuracyPct + '%';
      $('solved').textContent = m.stats.totalCorrect + '/' + m.stats.totalAsked;
      $('partial').textContent = m.stats.totalPartial;
      $('streak').textContent = m.stats.currentStreak;
      $('best').textContent = m.stats.bestStreak;
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
