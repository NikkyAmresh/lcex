# Changelog

All notable changes to LeetCode Practice will be documented in this file.

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
