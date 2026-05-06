(() => {
  const CURSOR_URI = "cursor://NikkyAmresh.leetcode-practice/open/";
  const BRAIN_URL = "https://dsa-portal.algofunds.in/question/";
  const DATA_ATTR = "data-lcex-cursor-btn";
  const BRAIN_DATA_ATTR = "data-lcex-brain-btn";

  function extractSlug(url) {
    if (!url) return null;
    const u = url.startsWith("http") ? url : new URL(url, "https://leetcode.com").href;
    const match = u.match(/leetcode\.com\/problems\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function isProblemLink(href) {
    if (!href) return false;
    return (
      href.startsWith("https://leetcode.com/problems/") ||
      href.startsWith("/problems/") ||
      href.startsWith("./problems/")
    );
  }

  function createButton(slug) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Open in Cursor (LeetCode Practice)";
    btn.textContent = "</>";
    btn.setAttribute(DATA_ATTR, "true");
    btn.style.cssText = `
      font-size: 11px;
      padding: 2px 6px;
      margin-left: 6px;
      background: #282c34;
      color: #61afef;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: inline-block;
      vertical-align: middle;
    `;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const a = document.createElement("a");
      a.href = CURSOR_URI + slug;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    return btn;
  }

  function createBrainButton(slug) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Open in DSA Portal (Brain)";
    btn.textContent = "🧠";
    btn.setAttribute(BRAIN_DATA_ATTR, "true");
    btn.style.cssText = `
      font-size: 11px;
      padding: 2px 6px;
      margin-left: 6px;
      background: #2d1b4e;
      color: #c39bff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: inline-block;
      vertical-align: middle;
    `;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(BRAIN_URL + slug, "_blank", "noopener,noreferrer");
    });
    return btn;
  }

  function addButtons() {
    document.querySelectorAll(`a[href*="/problems/"]`).forEach((link) => {
      const href = link.getAttribute("href") || link.href;
      if (!isProblemLink(href)) return;
      const slug = extractSlug(href);
      if (!slug) return;
      const parent = link.parentElement;
      if (!parent) return;

      let anchor = link;
      if (link.getAttribute(DATA_ATTR) !== "true" && !parent.querySelector(`[${DATA_ATTR}="true"]`)) {
        const cursorBtn = createButton(slug);
        parent.insertBefore(cursorBtn, anchor.nextSibling);
        anchor = cursorBtn;
      } else {
        anchor = parent.querySelector(`[${DATA_ATTR}="true"]`) || link;
      }

      if (!parent.querySelector(`[${BRAIN_DATA_ATTR}="true"]`)) {
        const brainBtn = createBrainButton(slug);
        parent.insertBefore(brainBtn, anchor.nextSibling);
      }
    });
  }

  const observer = new MutationObserver(() => addButtons());
  observer.observe(document.body, { childList: true, subtree: true });
  addButtons();
})();
