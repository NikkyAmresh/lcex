(() => {
  const CURSOR_URI = "cursor://lcex.leetcode-practice/open/";
  const DATA_ATTR = "data-lcex-cursor-btn";

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
    btn.textContent = "Cursor";
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

  function addButtons() {
    document.querySelectorAll(`a[href*="/problems/"]`).forEach((link) => {
      if (link.getAttribute(DATA_ATTR) === "true") return;
      const href = link.getAttribute("href") || link.href;
      if (!isProblemLink(href)) return;
      const slug = extractSlug(href);
      if (!slug) return;
      const existing = link.parentElement?.querySelector(`[${DATA_ATTR}="true"]`);
      if (existing) return;
      const btn = createButton(slug);
      link.parentElement?.insertBefore(btn, link.nextSibling);
    });
  }

  const observer = new MutationObserver(() => addButtons());
  observer.observe(document.body, { childList: true, subtree: true });
  addButtons();
})();
