import * as crypto from "node:crypto";
import type { FeedbackTile } from "./FeedbackStats";

/**
 * The feedback page. Pure string rendering, no `vscode` import, so the page
 * can be rendered and inspected outside the editor.
 */

export interface FeedbackPageData {
  headline: string;
  summary: string;
  tiles: FeedbackTile[];
  displayName?: string;
  signedInEmail: string | null;
  logoUri: string;
}

function nonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

export function renderFeedbackHtml(cspSource: string, data: FeedbackPageData): string {
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `img-src ${cspSource} https: data:`,
  ].join("; ");
  const dataJson = JSON.stringify({ displayName: data.displayName ?? null })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const tiles = data.tiles
    .map(
      (t) =>
        `<div class="tile"><div class="v">${escapeHtml(t.value)}</div><div class="l">${escapeHtml(t.label)}</div></div>`
    )
    .join("");
  const stars = [1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<button type="button" class="star" role="radio" aria-checked="false" aria-label="${i} ${i === 1 ? "star" : "stars"}" data-value="${i}" tabindex="${i === 1 ? 0 : -1}">${STAR_SVG}</button>`
    )
    .join("");
  const contact = data.signedInEmail
    ? `<label class="contact"><input type="checkbox" id="contact"/><span>You can contact me about this (${escapeHtml(data.signedInEmail)})<span class="help">Your email is attached only while this box is ticked.</span></span></label>`
    : `<p class="help standalone">Sent anonymously under your install id. Sign in to Cloud Sync first if you would like a reply.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Send Feedback</title>
<style>
  :root { --accent: #ffa116; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 24px 48px;
    font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5;
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
  }
  main { max-width: 640px; margin: 0 auto; padding-top: 36px; }
  header { display: flex; align-items: center; gap: 16px; }
  header img { width: 44px; height: 44px; flex: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  .summary { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 24px 0 28px; }
  .tile {
    padding: 12px 14px; border-radius: 8px;
    border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background);
  }
  .tile .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .tile .l { margin-top: 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  fieldset { border: none; padding: 0; margin: 0 0 24px; }
  legend, label.block { display: block; padding: 0; margin-bottom: 8px; font-weight: 600; }
  .rating-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .stars { display: flex; gap: 2px; }
  .star {
    background: none; border: none; padding: 4px; border-radius: 6px; cursor: pointer; line-height: 0;
    color: var(--vscode-descriptionForeground); opacity: .45;
  }
  .star svg { width: 34px; height: 34px; fill: currentColor; transition: transform .12s ease; }
  .star.on { color: var(--accent); opacity: 1; }
  .star:hover svg, .star:focus-visible svg { transform: scale(1.12); }
  .star:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .star:disabled { cursor: default; }
  .caption { min-width: 90px; color: var(--vscode-descriptionForeground); }
  textarea {
    width: 100%; min-height: 128px; padding: 10px 12px; resize: vertical;
    font-family: inherit; font-size: 13px; line-height: 1.5; border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
  }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  textarea:focus { outline: none; border-color: var(--accent); }
  .counter { margin-top: 4px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
  .contact { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0 24px; cursor: pointer; }
  .contact input { margin: 3px 0 0; accent-color: var(--accent); }
  .help { display: block; margin-top: 2px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .help.standalone { margin: 10px 0 24px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .btn {
    font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border: none; border-radius: 6px; padding: 9px 18px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .btn.secondary { font-weight: 500; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .foot { margin-top: 28px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  section[data-view] { display: none; }
  main[data-state="form"] section[data-view="form"],
  main[data-state="submitting"] section[data-view="form"],
  main[data-state="thanks"] section[data-view="thanks"],
  main[data-state="error"] section[data-view="error"] { display: block; }
  .done .mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; margin-top: 32px; border-radius: 50%;
    background: rgba(255, 161, 22, .16); color: var(--accent);
  }
  .done h2 { font-size: 18px; font-weight: 600; margin: 16px 0 6px; }
  .done p { margin: 0 0 20px; color: var(--vscode-descriptionForeground); max-width: 480px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main data-state="form">
  <header>
    <img src="${data.logoUri}" alt="lcex" />
    <div>
      <h1>${escapeHtml(data.headline)}</h1>
      <p class="summary">${escapeHtml(data.summary)}</p>
    </div>
  </header>

  <section data-view="form">
    ${tiles ? `<div class="tiles">${tiles}</div>` : `<div style="height:24px"></div>`}
    <fieldset>
      <legend>How would you rate lcex?</legend>
      <div class="rating-row">
        <div class="stars" role="radiogroup" aria-label="Rating">${stars}</div>
        <span id="caption" class="caption" aria-hidden="true"></span>
      </div>
      <span id="live" class="sr" aria-live="polite"></span>
    </fieldset>

    <label class="block" for="comment">What would make it better? (optional)</label>
    <textarea id="comment" rows="6" maxlength="2000" placeholder="What is working, what is missing, what got in your way"></textarea>
    <div id="counter" class="counter">0 / 2000</div>

    ${contact}

    <div class="row">
      <button id="send" class="btn" type="button" disabled>Send feedback</button>
      <button id="not-now" class="btn secondary" type="button">Not now</button>
    </div>
    <p class="foot">We store the rating, the comment, the numbers shown above, the extension version and platform. Nothing else.</p>
  </section>

  <section data-view="thanks" class="done">
    <div class="mark">${CHECK_SVG}</div>
    <h2 id="thanks-title">Thanks.</h2>
    <p id="thanks-body"></p>
    <div class="row">
      <button class="btn" type="button" data-open="marketplace" data-cta="marketplace">Rate on Marketplace</button>
      <button class="btn" type="button" data-open="issues" data-cta="issues">Open a GitHub issue</button>
      <button class="btn secondary" type="button" data-close>Close</button>
    </div>
  </section>

  <section data-view="error" class="done">
    <h2>Saved, not sent yet.</h2>
    <p>We could not reach the server. Your feedback is stored locally and will be sent the next time lcex starts.</p>
    <div class="row">
      <button id="retry" class="btn" type="button">Retry</button>
      <button class="btn secondary" type="button" data-close>Close</button>
      <button class="btn secondary" type="button" data-open="marketplace" data-cta="marketplace">Rate on Marketplace</button>
      <button class="btn secondary" type="button" data-open="issues" data-cta="issues">Open a GitHub issue</button>
    </div>
  </section>
</main>

<script nonce="${n}">
(function () {
  var vscode = acquireVsCodeApi();
  var DATA = ${dataJson};
  var CAPTIONS = ['', 'Not useful', 'Needs work', 'It is okay', 'Good', 'Excellent'];
  var main = document.querySelector('main');
  var stars = Array.prototype.slice.call(document.querySelectorAll('.star'));
  var caption = document.getElementById('caption');
  var live = document.getElementById('live');
  var comment = document.getElementById('comment');
  var counter = document.getElementById('counter');
  var contact = document.getElementById('contact');
  var send = document.getElementById('send');
  var notNow = document.getElementById('not-now');
  var retry = document.getElementById('retry');
  var rating = 0, hover = 0, busy = false;

  function setState(s) { main.setAttribute('data-state', s); }

  function paint() {
    var n = hover || rating;
    stars.forEach(function (b, i) {
      b.classList.toggle('on', i < n);
      b.setAttribute('aria-checked', i + 1 === rating ? 'true' : 'false');
      b.tabIndex = (rating ? i + 1 === rating : i === 0) ? 0 : -1;
      b.disabled = busy;
    });
    caption.textContent = n ? CAPTIONS[n] : '';
    send.disabled = busy || rating === 0;
    send.textContent = busy ? 'Sending...' : 'Send feedback';
    comment.disabled = busy;
    notNow.disabled = busy;
    if (contact) contact.disabled = busy;
  }

  function select(n, focus) {
    rating = n;
    live.textContent = n + ' of 5, ' + CAPTIONS[n];
    paint();
    if (focus) stars[n - 1].focus();
  }

  stars.forEach(function (b, i) {
    b.addEventListener('click', function () { if (!busy) select(i + 1, false); });
    b.addEventListener('mouseenter', function () { if (!busy) { hover = i + 1; paint(); } });
    b.addEventListener('mouseleave', function () { hover = 0; paint(); });
    b.addEventListener('keydown', function (e) {
      if (busy) return;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, i + 2);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, i);
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = 5;
      else if (/^[1-5]$/.test(e.key)) next = Number(e.key);
      else if (e.key === ' ' || e.key === 'Enter') next = i + 1;
      if (next !== null) { e.preventDefault(); select(next, true); }
    });
  });

  comment.addEventListener('input', function () {
    counter.textContent = comment.value.length + ' / 2000';
  });

  send.addEventListener('click', function () {
    if (busy || rating === 0) return;
    busy = true;
    setState('submitting');
    paint();
    vscode.postMessage({
      type: 'submit',
      rating: rating,
      comment: comment.value,
      allowContact: !!(contact && contact.checked)
    });
  });

  notNow.addEventListener('click', function () { vscode.postMessage({ type: 'close' }); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', function () { vscode.postMessage({ type: 'close' }); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
    b.addEventListener('click', function () {
      vscode.postMessage({ type: 'openExternal', target: b.getAttribute('data-open') });
    });
  });

  retry.addEventListener('click', function () {
    if (busy) return;
    busy = true;
    retry.disabled = true;
    retry.textContent = 'Sending...';
    vscode.postMessage({ type: 'retry' });
  });

  function showOutcome(r, delivered) {
    busy = false;
    paint();
    retry.disabled = false;
    retry.textContent = 'Retry';
    var good = r >= 4;
    document.getElementById('thanks-title').textContent = DATA.displayName ? 'Thanks, ' + DATA.displayName + '.' : 'Thanks.';
    document.getElementById('thanks-body').textContent = good
      ? 'Glad it is working for you. A Marketplace review helps other people find lcex.'
      : 'Sorry it is not there yet. If you can, open an issue with the details and we will look at it.';
    Array.prototype.forEach.call(document.querySelectorAll('[data-cta="marketplace"]'), function (el) { el.hidden = !good; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-cta="issues"]'), function (el) { el.hidden = good; });
    setState(delivered ? 'thanks' : 'error');
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    if (m.type === 'submitted') showOutcome(Number(m.rating) || rating, !!m.delivered);
  });

  paint();
})();
</script>
</body>
</html>`;
}
