# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## High-Level Architecture

**LeetCode Practice** is a VS Code extension that integrates LeetCode problem solving directly into the editor. The extension consists of:

- **VS Code Extension** (`src/extension.ts`): Activation, command registration, context management, file decorations, and URI handler for `vscode://lcex.leetcode-practice/open/{slug}`
- **Problem Data Layer**: Two interchangeable providers via `IProblemProvider` interface:
  - `LeetCode.ts`: GraphQL queries to LeetCode's official API (default)
  - `InternalProvider.ts`: Optional custom backend API (configured via `internalApiUrl`)
- **UI Layer**: 
  - **Sidebar views** (Problem Browser, Study Plans, Problem Lists, QOTD): Powered by `ProblemsProvider.ts` (tree view)
  - **WebView panels**: Problem statements and solutions via `ProblemView.ts`
  - **Custom editors** for `.leetcode` config, `.lcInterview` files, `.lcireport` reports, and `.hint` solution notes
- **Workspace Integration**: 
  - `.leetcode` JSON file (marker) in workspace root enables extension and allows per-workspace overrides
  - Local state stored in VS Code's `globalState` (extension-wide) and `workspaceState` (workspace-specific)
  - Context strings control UI visibility (e.g., `leetcodePractice.hasMarker`, `leetcodePractice.interviewMode`)

## Key Modules

| Module | Purpose |
|--------|---------|
| **extension.ts** | Activation, command palette commands, context management, file decorations, status bar items |
| **LeetCode.ts** | GraphQL queries for problems, study plans, difficulty data, QOTD; parsing + caching |
| **InternalProvider.ts** | Fallback provider for internal APIs; same `IProblemProvider` interface |
| **Database.ts** | Session management (LeetCode cookies), target directory resolution, file naming |
| **ProblemView.ts** | WebView rendering, example runner, terminal execution, stats/interview webviews, hint file creation |
| **ProblemsProvider.ts** | Sidebar tree view, problem status tracking (solved/attempting/cleared), filtering, search |
| **ExampleRunner.ts** | Parse and run `console.log`/`print` blocks; compare vs `// Expected:` comments |
| **LeetcodeConfig.ts** | Parse `.leetcode` JSON; merge with VS Code settings; resolve study plans + problem lists |
| **Authentication.ts** | Handle LeetCode session login/logout (cookies in globalState) |
| **Gamification.ts** | XP tracking (first-solve, interview bonus, focus participation, daily login), levels, streaks, daily goals |
| **InterviewMode.ts** | Timed interview sessions, problem focus tracking, elapsed time per problem, bonus XP calculation |
| **ProblemTimer.ts** | Track practice time by day; used for interview mode and stats |
| **LanguageStrategy.ts** | Multi-language support (TypeScript, JavaScript, Python, C++); EJS template generation |
| **TemplateEngine.ts** | Generate solution files using EJS templates with problem context |
| **HintFile.ts** | Create/parse `.hint` files for solution notes and hint analysis |
| **HintAnalysisHtml.ts** | Render hint/analysis webviews with syntax highlighting (Shiki) |
| **LcInterviewFile.ts** | Parse/serialize `.lcInterview` JSON (mock interview plans) |
| **LcInterviewEditorProvider.ts** | Custom editor UI for `.lcInterview` files |
| **LcexInterviewReportStore.ts** | Report file management and path resolution |
| **LcInterviewReportEditorProvider.ts** | Custom editor UI for `.lcireport` snapshot files |
| **CursorLcexPluginInstall.ts** | Sync `lcex-interview-generator` skill to `~/.cursor/plugins/local/` |
| **LcexFontInstall.ts** | Sync bundled fonts to `~/.lcex/fonts/` |
| **cloud/firebaseApp.ts** | Firebase initialization for cloud stats sync |
| **cloud/cloudStatsSync.ts** | Push/pull global stats to Firestore; background sync loop |

## Important Implementation Patterns

### Workspace Marker & Context Management
- The extension activates only when a `.leetcode` file exists in any workspace folder (`workspaceContains:**/.leetcode`)
- Context strings (`setContext`) control UI visibility:
  - `leetcodePractice.hasMarker` — boolean; controls sidebar visibility
  - `leetcodePractice.showProblemset`, `showStudyPlans`, `showProblemLists`, `showQotd` — per-view flags
  - `leetcodePractice.isSolutionFile` — true if active editor is a solution file (.ts/.js/.py/.cpp)
  - `leetcodePractice.interviewMode` — true during timed interview sessions
- Context is updated on workspace changes, folder additions, and file/editor changes

### Data Storage & Caching
- **Session**: LeetCode cookie stored in `globalState` under `"leetcodeSession"`
- **Problem Status**: Entries stored as `"leetcode-<titleSlug>"` in `globalState` with `{ status, solvedAt }` object
- **Problemset Cache**: Stored as `~/.lcex/problemset-cache.json` (all problems) and `~/.lcex/<slug>-cache.json` (study plans/problem lists)
- **Interview Data**: Stored in `globalState` under `"leetcode-interviewSession"` (active) and `"leetcode-interviewHistory"` (past 50 sessions)
- **XP & Gamification**: Separate keys in `globalState` for total XP, granted slugs, daily goals, timer data

### Problem Webview & Custom Editors
- Problem statement rendered in WebView (`ProblemView.ts`)
- File decorations show problem titles on numbered files (cached, 60s TTL)
- Custom editors for `.leetcode`, `.lcInterview`, `.lcireport`, `.hint` files use WebView-based UIs
- Plain-text fallback for `.leetcode` files via `registerProblemPlainTextDocumentProvider`

### Example Runner & Terminal Execution
- **Run Examples**: Parse lines with `console.log()`/`print()`, extract expected output from `// Expected:` comments, execute via Node/Python, compare results
- **Run in Terminal**: Full file execution via `tsx` (TypeScript), `node` (JavaScript), or `python3` (Python)

### Interview Mode
- Starts a timed session (45/60/180 minutes)
- Activates focus layout (Zen mode + closed sidebar/panel) and strict webview (no hints/explain buttons)
- Tracks "focused problem" (last opened slug) and per-problem elapsed time
- **Mark as solved** records the slug for interview scoring; **Mark solved (this interview)** records without granting first-solve XP
- On session end, calculates interview bonus XP: sum of first-solve values for planned problems marked solved, plus +30 if all planned problems cleared
- Reports stored as `<folder-containing-.lcInterview>/<sanitized-interview-name>/report-<attemptId>.lcireport` (version 1)

### Configuration Override Hierarchy
1. `.leetcode` file (workspace-specific JSON) — highest priority
2. VS Code workspace settings (`settings.json`) — fallback
3. Hardcoded defaults — fallback

Common fields: `fileNamePattern`, `language`, `defaultDirectory`, `internalApiUrl`, `studyPlans`, `problemLists`, `showProblemset`, etc.

## Essential Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies + devDependencies |
| `npm run compile` | TypeScript → JavaScript; copies EJS templates to `out/` |
| `npm run copy-assets` | Copies EJS templates from `src/templates/` to `out/` (usually invoked by `compile`) |
| `npm run watch` | Continuous TypeScript compilation (`tsc -w`) |
| `npm test` | Integration test hitting LeetCode API (`node --test --import tsx test/integration.test.ts`) |
| `npm run package` | Build `.vsix` for marketplace/manual installation |
| `npm run install-extension` | Package, then install locally via `code --install-extension` |

## Project Layout

```
lcex/
├── src/
│   ├── extension.ts               # Entry point, command registration, context management
│   ├── modules/                   # Core modules (see table above)
│   ├── modules/interface/         # TypeScript interfaces (Problem, Session, etc.)
│   ├── modules/language/          # Language strategies and template engine
│   ├── modules/cloud/             # Firebase and cloud sync
│   ├── templates/                 # EJS solution file templates (TypeScript/JavaScript/Python/C++)
│   └── utils/                     # Utilities (apiPoller.ts)
├── chrome-extension/              # Chrome extension sources (open-in-editor)
├── test/                          # Integration tests
├── icons/                         # Icons and file themes
├── themes/                        # Color themes
├── package.json                   # Extension manifest + npm scripts
└── tsconfig.json                  # TypeScript config
```

## Code Organization Notes

- **No circular imports**: Modules are organized to avoid cycles. Use typed interfaces in `modules/interface/` for cross-module contracts.
- **VS Code API context**: Global extension context passed through many functions for state access; `extensionContextForBars` is a global set during activation.
- **Webview lifecycle**: Webview panels are preserved (`retainContextWhenHidden: true`); messages flow through `webview.onDidReceiveMessage()`.
- **Error handling**: Log via `Logger.ts`; user-facing errors use `vscode.window.showErrorMessage()`.
- **Firebase optional**: Cloud stats sync gracefully handles missing Firebase auth; no crashes if not configured.

## When Modifying Core Flows

- **Adding a command**: Register in `extension.ts` (`package.json` + `registerCommand`), update context if needed, implement handler
- **Modifying problem fetch**: Update GraphQL queries in `LeetCode.ts` and/or `InternalProvider.ts`
- **Changing status tracking**: Update `setProblemStatus()` and related logic in `ProblemsProvider.ts`; ensure cache is invalidated
- **Interview logic changes**: Update `InterviewMode.ts` (state management) and `ProblemView.ts` (webview UI); test report generation
- **Gamification changes**: Update `Gamification.ts` (XP calculation), ensure proper event hooks in `ProblemView.ts` and `InterviewMode.ts`
- **Configuration schema changes**: Update `LeetcodeConfig.ts` and `package.json` (contributes.configuration)

## Testing Notes

- Integration test runs against real LeetCode API; skips auth tests if no session cookie available
- Build must succeed (`npm run compile`) before packaging or testing
- No unit test framework in place; rely on TypeScript compilation for type safety and manual testing in VS Code

