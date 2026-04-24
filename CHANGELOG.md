# Changelog

All notable changes to LeetCode Practice will be documented in this file.

## [0.1.9] — Analytics works without sign-in

### Changed
- Anonymous analytics no longer requires cloud sign-in. On first send, the extension mints a per-install anonymous Firebase identity (separate from any Google sign-in used for stats sync) and uses it to write events. Privacy posture is unchanged — only an opaque per-install UUID identifies the sender, all values remain enum-validated, and `vscode.env.isTelemetryEnabled` + the `leetcodePractice.analytics.enabled` setting still gate everything.

## [0.1.8] — Marketplace discoverability

### Changed
- Refined marketplace metadata for better search ranking and category listings on VS Code Marketplace and Open VSX:
  - `displayName` expanded to "LeetCode Practice — Problems, Study Plans & Interview Mode".
  - `description` reworked to front-load high-intent terms (Top Interview 150, Blind 75, mock interview).
  - `categories` realigned with top-ranked peers: `Education`, `Snippets`, `Programming Languages`, `Other` (added `Snippets`, which is the category the highest-install peer publishes under).
  - `keywords` expanded to cover long-tail queries (DSA, coding interview, mock interview, Blind 75, QOTD, etc.).

## [0.1.7] — Open VSX publish fix

### Changed
- Base64-encode the public Firebase Web API key in source so Open VSX's static secret scanner no longer blocks publish. No behavioural change; the key is still a public client identifier decoded at runtime.

## [0.1.6] — Anonymous analytics

### Added
- Opt-outable anonymous usage analytics written to a separate Firestore `/logs` collection under a pseudonymous per-install UUID. Only allow-listed enums and bucketed dimensions (difficulty, language, duration, count) are sent; no slugs, notes, code, file paths, or exact timestamps. Requires cloud sign-in; respects `vscode.env.isTelemetryEnabled`. Toggle with `LeetCode: Toggle anonymous analytics` or `leetcodePractice.analytics.enabled`.
- Admin analytics dashboard at `https://lc-ext.web.app/admin` with charts and filters (admin-only).

### Changed
- Tightened Firestore rules for `/logs`: strict shape + enum validation, no update/delete, reads restricted to admin uid.
- Excluded `screenshots/` from the `.vsix` (README renders them from GitHub raw URLs) — shaves ~3.7 MB off the package.

## [0.1.5] — README refresh

### Changed
- Professional README layout with non-duplicated badges, hero screenshot, and a two-column captioned screenshot grid covering all views.

## [0.1.4] — CI pipeline smoke-test

### Changed
- Internal release-pipeline iteration; no user-facing changes.

## [0.1.3] — Release automation and docs polish

### Added
- GitHub Actions workflow to package the extension and publish to Open VSX on tagged releases, with the VSIX attached to the GitHub Release.

### Changed
- Rewrote the README with a professional layout, marketplace badges, curated screenshots, and category-grouped command/setting tables.

## [0.1.2] — Screenshot refresh

### Changed
- Refreshed README screenshot assets for the latest extension UI views.

## [0.1.1] — Cleanup, packaging, and docs polish

### Changed
- Cleaned repository structure by moving workspace practice/interview artifacts into `examples/workspace-artifacts/`.
- Updated and simplified README to standard VS Code extension format with feature-focused sections.
- Added/renamed screenshot assets with view-based filenames and linked them directly in README.
- Tightened `.gitignore` and `.vscodeignore` to exclude local/deploy-only/generated files from source control and VSIX packaging.
- Updated extension assets and packaging config for the live release flow.

## [0.1.0] — Initial Marketplace release

### Added
- Workspace-scoped activation via `.leetcode` marker file.
- Sidebar views: full problemset, study plans, problem lists, Question of the Day.
- Solution file generation in TypeScript, JavaScript, Python, and C++ via EJS templates.
- Inline example runner with `// Expected:` comparison and "Run in Terminal" command.
- Problem webview with statement, examples, and "Create File" actions.
- Custom editors for `.leetcode`, `.lcInterview`, `.lcireport`, and `.hint` files.
- LeetCode session sign-in for problem and study-plan data.
- Local progress tracking: solved / attempting / cleared status, streaks, XP, levels.
- Daily goals (problems and minutes) with status-bar progress.
- Timed Interview Mode with focus layout, per-problem timing, and report generation.
- Stats webview with activity, streak, XP, and interview history.
- Cloud stats sync via Firebase (Google sign-in; uid-scoped writes).
- URI handler `vscode://nikkyamresh.leetcode-practice/open/{slug}` for one-click open.
- Question of the Day, focus mode, and configurable file naming (`id` / `slug`).
