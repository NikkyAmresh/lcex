<div align="center">

<img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/icons/icon.png" width="96" height="96" alt="LeetCode Practice" />

# LeetCode Practice

**Solve LeetCode in your editor. Track progress. Run timed interviews.**

A VS Code and Cursor extension with problem browsing, template generation, inline example runners, XP/streak tracking, and timed interview workflows — with optional cloud sync.

[![Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/NikkyAmresh.leetcode-practice?label=VS%20Marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice)
[![Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/NikkyAmresh.leetcode-practice?color=007ACC)](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice)
[![Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/NikkyAmresh.leetcode-practice?color=007ACC)](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice)
[![Open VSX Version](https://img.shields.io/open-vsx/v/nikkyamresh/leetcode-practice?label=Open%20VSX&color=A60EE9)](https://open-vsx.org/extension/nikkyamresh/leetcode-practice)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/nikkyamresh/leetcode-practice?color=A60EE9)](https://open-vsx.org/extension/nikkyamresh/leetcode-practice)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

<!-- TODO: replace the hero screenshot below with a short demo GIF showing: open sidebar → pick problem → generate file → run examples → mark solved -->

![Problem view with inline run in terminal](https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/02-problem-view-run-terminal.png)

---

## Install

- **VS Code** — [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice), or run in the command palette:
  ```
  ext install NikkyAmresh.leetcode-practice
  ```
- **Cursor / VSCodium / other OSS editors** — [Install from Open VSX](https://open-vsx.org/extension/nikkyamresh/leetcode-practice)

The extension activates automatically when a workspace contains a `.leetcode` file.

## Quick Start

1. Open a folder in VS Code or Cursor.
2. Create a `.leetcode` file in the workspace root (an empty `{}` is enough).
3. Run **LeetCode: Sign In** from the command palette.
4. Open the **LeetCode** sidebar and pick a problem.
5. Click **Create File**, solve, then run with **LeetCode: Run Examples** or `Ctrl/Cmd+Shift+R`.

## Features

### Browse and solve

Browse the full problemset, study plans, curated problem lists, and Question of the Day from the sidebar. Open any problem in a rich webview, generate a solution file in TypeScript, JavaScript, Python, or C++, and run examples inline or in the terminal.

### Track progress

Solved / attempting / cleared states per problem, daily streaks, XP and levels, daily goals for problems and minutes, and a stats dashboard with trends.

![Stats overview](https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/05-stats-overview.png)

### Interview mode

Run ad-hoc timed sessions (45 / 60 / 180 min) or plan structured mocks with `.lcInterview` files. Focus layout hides hints and distractions; per-problem timing and a generated `.lcireport` snapshot capture each attempt.

![Interview report](https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/04-lcinterview-report.png)

### Solution notes and agent actions

Capture notes in `.hint` files next to each solution, and trigger agent actions from the editor: **Make Runnable**, **Hint**, and **Explain My Code**.

![Solution notes with hint and analyze actions](https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/08-solution-notes-hint-analyze.png)

### Workspace config editor

A custom editor for `.leetcode` makes it easy to configure study plans, problem lists, language, and file-naming conventions per workspace.

![.leetcode config editor](https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/01-config-editor.png)

### Cloud sync (optional)

Sign in with Google to push and pull your stats across machines via Firebase. Fully optional — the extension works entirely offline without it.

## Commands

All commands are available under the **LeetCode** category in the command palette.

### Problems

| Command | Description |
| --- | --- |
| `LeetCode: Open/Create Problem` | Open a problem and create its solution file |
| `LeetCode: Open Question of the Day` | Jump straight to today's QOTD |
| `LeetCode: Refresh Problems` | Re-fetch the problemset cache |
| `LeetCode: Sign In` / `Sign Out` | Manage the LeetCode session cookie |

### Running

| Command | Shortcut | Description |
| --- | --- | --- |
| `LeetCode: Run Examples` | — | Parse `// Expected:` comments and diff results |
| `LeetCode: Run in Terminal` | `Ctrl/Cmd+Shift+R` | Execute the current solution file |

### Interview

| Command | Description |
| --- | --- |
| `LeetCode: Interview Mode — Start` / `Stop` | Run an ad-hoc timed session |
| `LeetCode: Generate LC Interview (AI)` | Scaffold a planned `.lcInterview` |
| `LeetCode: Open LC Interview Report…` | Browse `.lcireport` history |

### Stats and goals

| Command | Description |
| --- | --- |
| `LeetCode: View Stats` | Open the stats dashboard |
| `LeetCode: Set Daily Goal` | Configure daily problem / minute targets |

### Cloud sync

| Command | Description |
| --- | --- |
| `LeetCode: Sign in to Cloud Sync` / `Sign out of Cloud Sync` | Manage Firebase session |
| `LeetCode: Set LeetCode username` | Link your LeetCode handle |
| `LeetCode: Push stats to cloud now` / `Pull stats from cloud` | Manual sync |

## Extension Settings

| Setting | Description |
| --- | --- |
| `leetcodePractice.defaultDirectory` | Where new solution files are created |
| `leetcodePractice.fileNamePattern` | `id` (e.g. `1.ts`) or `slug` (e.g. `two-sum.ts`) |
| `leetcodePractice.language` | `typescript`, `javascript`, `python`, or `cpp` |
| `leetcodePractice.problemViewMode` | Layout for the problem webview |
| `leetcodePractice.suppressAiTabOnSolve` | Don't reopen AI tab after marking solved |
| `leetcodePractice.suppressAiTabWorkspaceWide` | Workspace-wide version of the above |
| `leetcodePractice.internalApiUrl` | Use a custom backend instead of LeetCode's GraphQL |
| `leetcodePractice.activeStudyPlan` | Currently active study plan slug |
| `leetcodePractice.activeProblemList` | Currently active problem list slug |
| `leetcodePractice.studyPlans` | Study plans to show in the sidebar |
| `leetcodePractice.problemLists` | Curated problem lists to show in the sidebar |
| `leetcodePractice.showProblemLists` | Toggle the problem lists view |
| `leetcodePractice.leetcodeUsername` | LeetCode username for cloud sync |

## Workspace Config (`.leetcode`)

Any setting above can be overridden per-workspace in the `.leetcode` file. Workspace values take precedence over user settings.

```json
{
  "studyPlans": [{ "slug": "top-interview-150", "name": "Top Interview 150" }],
  "problemLists": [{ "slug": "graph", "name": "Graph" }],
  "activeStudyPlan": "top-interview-150",
  "activeProblemList": "graph",
  "language": "typescript",
  "fileNamePattern": "id",
  "defaultDirectory": "."
}
```

## Requirements

- VS Code or Cursor **1.85+**
- Node.js — for TypeScript / JavaScript execution
- Python 3 — optional, for Python solutions
- A C++ toolchain — optional, for C++ solutions

## Development

```bash
npm install
npm run compile         # or: npm run watch
npm test                # integration test against LeetCode API
npm run package         # produces a .vsix
npm run install-extension
```

See [`CLAUDE.md`](CLAUDE.md) for a module-by-module architecture tour.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
