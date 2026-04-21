<div align="center">

<img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/icons/icon.png" width="96" height="96" alt="LeetCode Practice" />

# LeetCode Practice

**Solve LeetCode in your editor. Track progress. Run timed interviews.**

A VS Code and Cursor extension with problem browsing, template generation, inline example runners, XP and streak tracking, and timed interview workflows — with optional cloud sync.

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/NikkyAmresh.leetcode-practice?label=VS%20Marketplace&logo=visualstudiocode&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice)
[![Open VSX](https://img.shields.io/open-vsx/v/nikkyamresh/leetcode-practice?label=Open%20VSX&logo=eclipseide&color=A60EE9)](https://open-vsx.org/extension/nikkyamresh/leetcode-practice)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/NikkyAmresh.leetcode-practice?label=installs&color=informational)](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<br/>

<!-- TODO: replace with a short demo GIF showing: open sidebar → pick problem → generate file → run examples → mark solved -->
<img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/02-problem-view-run-terminal.png" alt="Problem view with inline run in terminal" width="900" />

</div>

---

## Install

- **VS Code** — [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=NikkyAmresh.leetcode-practice), or in the command palette:
  ```
  ext install NikkyAmresh.leetcode-practice
  ```
- **Cursor, VSCodium, and other OSS editors** — [Install from Open VSX](https://open-vsx.org/extension/nikkyamresh/leetcode-practice)

The extension activates automatically when a workspace contains a `.leetcode` file.

## Quick Start

1. Open a folder in VS Code or Cursor.
2. Create a `.leetcode` file in the workspace root (an empty `{}` is enough).
3. Run **LeetCode: Sign In** from the command palette.
4. Open the **LeetCode** sidebar and pick a problem.
5. Click **Create File**, solve, then run with **LeetCode: Run Examples** or <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.

## Features

- **Browse and solve** — Full problemset, study plans, curated problem lists, and Question of the Day in sidebar views. Rich problem webview with "Create File" in TypeScript, JavaScript, Python, or C++.
- **Inline runner** — Parse `// Expected:` comments and diff against `console.log`/`print` output; or run the full solution in an integrated terminal.
- **Progress tracking** — Solved / attempting / cleared states, daily streaks, XP and levels, daily goals, and a stats dashboard with trends.
- **Interview mode** — Ad-hoc timed sessions (45 / 60 / 180 min) or planned `.lcInterview` mocks. Focus layout hides hints; each attempt produces a `.lcireport` snapshot.
- **Solution notes and agent actions** — Capture notes in `.hint` files; trigger **Make Runnable**, **Hint**, and **Explain My Code** from the editor.
- **Workspace config editor** — Custom editor for `.leetcode` files makes study plan, problem list, language, and file-naming overrides a UI action.
- **Cloud sync (optional)** — Sign in with Google to push and pull stats across machines via Firebase. Fully optional; the extension works offline without it.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/01-config-editor.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/01-config-editor.png" alt="Config editor" /></a>
      <br/><sub><b>.leetcode config editor</b></sub>
    </td>
    <td align="center" width="50%">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/02-problem-view-run-terminal.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/02-problem-view-run-terminal.png" alt="Problem view with run in terminal" /></a>
      <br/><sub><b>Problem view + run in terminal</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/03-lcinterview-plan-editor.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/03-lcinterview-plan-editor.png" alt="LC Interview plan editor" /></a>
      <br/><sub><b>.lcInterview plan editor</b></sub>
    </td>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/04-lcinterview-report.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/04-lcinterview-report.png" alt="LC Interview report" /></a>
      <br/><sub><b>.lcireport interview report</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/05-stats-overview.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/05-stats-overview.png" alt="Stats overview" /></a>
      <br/><sub><b>Stats overview</b></sub>
    </td>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/06-stats-charts.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/06-stats-charts.png" alt="Stats charts" /></a>
      <br/><sub><b>Minutes and solved trends</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/07-time-solved-breakdown.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/07-time-solved-breakdown.png" alt="Time and solved breakdown" /></a>
      <br/><sub><b>Daily time and solved breakdown</b></sub>
    </td>
    <td align="center">
      <a href="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/08-solution-notes-hint-analyze.png"><img src="https://raw.githubusercontent.com/NikkyAmresh/lcex/main/screenshots/08-solution-notes-hint-analyze.png" alt="Solution notes, hint, analyze" /></a>
      <br/><sub><b>Solution notes with hint and analyze</b></sub>
    </td>
  </tr>
</table>

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
| `LeetCode: Run in Terminal` | <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | Execute the current solution file |

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
