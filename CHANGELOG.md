# Changelog

All notable changes to LeetCode Practice will be documented in this file.

## [0.3.1] — Smarter complexity analysis

### Changed
- **Complexity budget engine rewritten.** Replaces the indent-only loop-counter with a structured analyzer that classifies each loop's bound (`const` / `log` / `√n` / `linear` / `amortized`), recognizes two-pointer / sliding-window / monotonic-stack as O(n) instead of O(n²), and applies Master-theorem reasoning to self-recursion (mergesort → O(n log n), DFS over adjacency → O(V+E)). Includes a curated call-cost catalog so a `sort` / `heappush` / `Array.includes` inside a loop upgrades the estimate correctly.
- **Confidence-aware severity.** When a loop's bound can't be classified statically the verdict is capped at 🟡 (`tight`) instead of escalating to 🔴, with the hover noting the fallback. Reduces false "over budget" labels on novel patterns.
- **Per-hotspot inline decorations.** Each loop / dominant call line now gets its own ghost-text annotation (`for ≈ O(n) · cumulative O(n²)`) with severity ranked against the budget's target depth, so the offending nest is visible without opening the hover.

### Defaults
- **Edge-case probes are now off by default** (`leetcodePractice.adversarialTests.enabled: false`). Run `LeetCode: Surface Adversarial Edge Cases` on demand or re-enable the setting if you want them back on save. Existing users who already set the flag explicitly are unaffected.

## [0.3.0] — Companies sidebar

### Added
- **Companies view.** New sidebar panel listing 463 companies and the ~100 LeetCode problems each one asks, with frequency, acceptance rate, difficulty (color-coded green/yellow/red dots), and topics (in the row tooltip). Click a problem to open it in the existing problem webview. Toggle the panel via `leetcodePractice.showCompanies`.
- **View-title actions:** search (filters across companies and problems by title / slug / topic), filter by difficulty, and refresh.
- **Solved / attempting overlays.** Status icons override the difficulty dot, matching the existing problem browser.
- **Topics + companies in the problem view.** Problem webview now lists relevant topics and the companies that ask the problem (with per-company frequency), populated from the same dataset.

### Credits
- Problem-frequency / acceptance / topic data is sourced from [`liquidslr/interview-company-wise-problems`](https://github.com/liquidslr/interview-company-wise-problems) (snapshot dated 1 June 2025).

## [0.2.1] — README: document the 0.2.0 inline-feedback suite

### Changed
- README and marketplace copy updated to cover lint / complexity budget / edge-case probes / on-save example results and their settings + commands. No runtime changes.

## [0.2.0] — Inline feedback suite

### Added
- **On-save inline feedback.** Saving a solution file now runs every enabled feature at once: interview lint, complexity budget, edge-case probes, and example results — all shown as ghost-text on the relevant lines, with a trusted-markdown hover for details and a one-click "turn off" link per feature.
- **Interview anti-pattern lint** (`leetcodePractice.lint.enabled`, default on): flags `mutate-input`, `builtin-sort`, `magic-number`, and indented `debug-print` across Python / TypeScript / JavaScript / C++. Emits both a `Diagnostic` (squiggle + Problems panel) and an inline hint per line. Suppressible with `// lcex-lint-ignore: <rule>` or `// lcex-lint-ignore: all`.
- **Complexity budget** (`leetcodePractice.complexityBudget.enabled`, default on): parses the problem's `Constraints:` section, derives a target complexity from the largest size cap, runs an indent-based loop-nesting estimator on your code, and paints 🟢 / 🟡 / 🔴 on the signature + each nested loop with the depth in superscript.
- **Adversarial edge-case probes** (`leetcodePractice.adversarialTests.enabled`, default on): turns parsed constraints into candidate edge cases (empty, single, max-size, boundary values, negatives, zeros, duplicate/sorted flags, charset mismatches) and surfaces them as an inline warning on the function signature. Advisory-only in this release.
- **Run examples on save** (`leetcodePractice.runExamplesOnSave.enabled`, default on): runs example lines automatically on save, with inline pass/fail per call and a dedicated timeout message for >15s runs. The on-demand command now also saves the document before running so line numbers and output stay in sync.
- **Master kill switch** (`leetcodePractice.inlineDecorations.enabled`) and `LeetCode: Clear Inline Decorations` command (`Cmd+K Cmd+L` / `Ctrl+K Ctrl+L`).
- Five toggle commands (`LeetCode: Toggle …`) for lint, complexity budget, edge-case probes, run-examples-on-save, and all inline decorations. Each is also reachable via the "turn off" link in a hover.

### Changed
- `Run Examples` now renders results inline as ghost-text next to each call line (`✓` / `✗ expected X · got Y`) instead of as a popup notification. Status bar shows the summary. Runtime errors and timeouts surface inline with a hover-for-details message.
- Editing a solution file now auto-clears stale inline decorations and `lcex-lint` diagnostics until the next save.
- Problem fetches for the new features share a 5-minute in-memory cache keyed by slug, so save-heavy workflows don't re-hit the LeetCode API.

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
