# LeetCode Practice

Practice LeetCode problems directly in VS Code (or Cursor). Generate TypeScript, JavaScript, or Python templates with example test cases, run examples inline, browse problems and study plans, track progress, and sync with your LeetCode account. A Chrome extension lets you open LeetCode problems from the browser into your editor with one click.

---

## Features

- **Problem browser** — Browse the LeetCode problemset in the sidebar
- **Study plans** — Dedicated sidebar + **Switch Study Plan**
- **Problem lists** — Separate sidebar + **Switch Problem List** (e.g. `/problem-list/graph/`)
- **Question of the Day** — Access daily challenges in a dedicated view
- **Solution file generation** — Create `167.ts`, `two-sum.ts`, or `167.py` (configurable) with LeetCode boilerplate and example test cases
- **Example runner** — Run example blocks (`console.log` / `print`) and see pass/fail inline
- **Run in terminal** — Run the solution file with ts-node / tsx / node / python (shortcut: `Cmd+Shift+R`)
- **Progress tracking** — Mark problems as Solved or Attempting, view stats (time per day, charts)
- **Streak, XP, and levels** — Local streak from solve dates; XP on first solve per problem (by difficulty); level from total XP (see **View Stats** and status bar)
- **Daily goals** — Set problems/day or practice minutes/day; progress on the stats page and in the status bar
- **Focus mode** — Command hides sidebar, panel, and enables Zen + maximized editor; problem webview can use **Focus** for a compact chrome (timer + Solve + Run)
- **Interview mode** — Timed sessions (45 / 60 / 180 min), optional planned slugs, no hints/explain, stricter webview; session history and bonus XP on **View Stats**
- **LeetCode sign-in** — Sync with your LeetCode account for problemset data
- **LeetCode Dark theme** — Optional auto-apply when a workspace has `.leetcode`
- **Cursor/Agent integration** — "Make Runnable", "Hint", and **Explain My Code** (selection) in the editor toolbar when a solution file is active
- **Chrome extension** — Add a "Cursor" button next to LeetCode problem links to open them in the extension via `vscode://` URI
- **Internal API** — Optional internal API base URL for fetching problem data instead of LeetCode

---

## Prerequisites

- **VS Code** or **Cursor** 1.85+
- **Node.js** (for TypeScript/JavaScript runs)
- **Python 3** (optional, for Python solutions)
- For TypeScript: `tsx` or `ts-node` (e.g. `npx tsx` — extension uses `npx --yes tsx`)

---

## Installation

### VS Code Extension

1. Build and install locally:

   ```bash
   npm install
   npm run package
   code --install-extension leetcode-practice-0.1.0.vsix --force
   ```

2. Or install from VSIX: **Extensions → ... → Install from VSIX** and select the built `.vsix` file.

### Chrome Extension (Optional)

For "Open in Cursor" buttons on LeetCode.com:

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `chrome-extension` folder in this repo

---

## Quick Start

1. Create a folder for your LeetCode solutions
2. Add a `.leetcode` file in the project root (see [Configuration](#configuration) below)
3. Open the folder in VS Code/Cursor
4. Sign in: Command Palette → **LeetCode: Sign In**
5. Use the **LeetCode** sidebar to browse problems, study plans, and daily challenges
6. Click a problem to open it in a webview; use **Create File** to generate your solution file
7. Solve the problem, run examples with **LeetCode: Run Examples**, or run in terminal with **Cmd+Shift+R**

---

## Commands

| Command | Description |
|--------|-------------|
| **LeetCode: Open/Create Problem** | Open a problem by ID or slug; creates solution file if configured |
| **LeetCode: Open Question of the Day** | Open today’s daily challenge |
| **LeetCode: Run Examples** | Run `console.log` / `print` example blocks and check expected output |
| **LeetCode: Run in Terminal** | Run the current solution file with ts-node/tsx/node/python |
| **LeetCode: Sign In** | Sign in to LeetCode |
| **LeetCode: Sign Out** | Sign out |
| **LeetCode: Refresh Problems** | Refresh problemset and study plan data |
| **LeetCode: Refresh Question of the Day** | Refresh QOTD list |
| **LeetCode: Filter by Difficulty** | Filter problems by Easy / Medium / Hard |
| **LeetCode: Search Problems** | Search by title or slug |
| **LeetCode: Open Random Problem** | Open a random (unsolved) problem |
| **LeetCode: View Stats** | Solved/attempting, streak, charts, XP/level, daily goal, interview history |
| **LeetCode: Refresh Stats Data** | Clear cached problemset difficulty used for stats and reload |
| **LeetCode: Set Daily Goal** | Problems per day, minutes per day, or clear goal |
| **LeetCode: Focus Mode (enter)** | Compact problem webview + hide sidebar/panel + Zen + maximize editor group |
| **LeetCode: Focus Mode (exit)** | Restore compact webview chrome; toggle workbench UI back (best effort) |
| **LeetCode: Interview Mode — Start** | Pick duration, optional planned slugs; starts countdown and strict session |
| **LeetCode: Interview Mode — Stop** | End session, log stats, award bonus XP |
| **LeetCode: Apply Theme** | Apply LeetCode Dark theme if `.leetcode` exists |
| **LeetCode: Switch Study Plan** | Switch active study plan |
| **Mark as Solved** | Mark the selected problem as solved (right‑click) |
| **Mark as Attempting** | Mark as attempting (right‑click) |
| **Clear Status** | Clear status (right‑click) |
| **LeetCode: Ask Agent – Make Runnable** | Open agent chat with make-runnable prompt |
| **LeetCode: Ask Agent – Hint** | Open agent chat with hint prompt |
| **LeetCode: Ask Agent – Explain My Code** | Open agent chat with selected code + structured explain prompt (disabled in Interview mode) |

---

## Configuration

### `.leetcode` (workspace)

Place a `.leetcode` JSON file in your project root (or in a subfolder). It overrides VS Code settings and enables the LeetCode sidebar and features.

Example:

```json
{
  "studyPlans": [
    { "slug": "top-interview-150", "name": "Top Interview 150" },
    { "slug": "30-days-of-javascript", "name": "30 Days of JavaScript" }
  ],
  "activeStudyPlan": "top-interview-150",
  "activeProblemList": "graph",
  "theme": "auto",
  "defaultDirectory": ".",
  "fileNamePattern": "id",
  "language": "typescript",
  "internalApiUrl": "",
  "problemLists": [{ "slug": "graph", "name": "Graph" }],
  "showProblemset": true,
  "showStudyPlans": true,
  "showProblemLists": true,
  "showQotd": true,
  "qotdMonths": 6,
  "agentPromptMakeRunnable": "Make this Runnable, do not give solution.",
  "agentPromptHint": "Give me a hint for this problem. Do not give the solution.",
  "agentPromptExplain": "Explain my solution… (intuition, dry run, complexity)."
}
```

| Field | Description |
|-------|-------------|
| `studyPlans` | Array of `{ slug, name }` for study plans (e.g. `top-interview-150`) |
| `problemLists` | Array of `{ slug, name }` for LeetCode problem lists (URL `/problem-list/<slug>/`) |
| `activeStudyPlan` | Default study plan slug (Study Plans sidebar when nothing is remembered) |
| `activeProblemList` | Default problem-list slug (Problem Lists sidebar when nothing is remembered) |
| `activeListSource` | Deprecated; only used to migrate old configs into `activeProblemList` |
| `theme` | `"auto"` \| `"leetcode-dark"` \| `"none"` — auto applies LeetCode Dark when workspace has `.leetcode` |
| `defaultDirectory` | Directory for new solution files (`.` = workspace root) |
| `fileNamePattern` | `"id"` → `167.ts` \| `"slug"` → `two-sum-ii-input-array-is-sorted.ts` |
| `language` | `"typescript"` \| `"javascript"` \| `"python"` |
| `internalApiUrl` | Optional internal API base URL for problem data |
| `showProblemset` | Show problemset view |
| `showStudyPlans` | Show study plans view |
| `showProblemLists` | Show the Problem Lists sidebar |
| `showQotd` | Show Question of the Day view |
| `qotdMonths` | Number of months of daily challenges to load |
| `agentPromptMakeRunnable` | Prompt sent when clicking "Make Runnable" |
| `agentPromptHint` | Prompt sent when clicking "Hint" |
| `agentPromptExplain` | Base prompt for **Explain My Code**; selected code and problem context are appended |

You can also edit `.leetcode` via the custom config editor: open the `.leetcode` file and use the visual editor.

### VS Code settings

All `leetcodePractice.*` settings can be overridden by `.leetcode`:

- `leetcodePractice.defaultDirectory`
- `leetcodePractice.fileNamePattern` (`id` \| `slug`)
- `leetcodePractice.language` (`typescript` \| `javascript` \| `python`)
- `leetcodePractice.internalApiUrl`
- `leetcodePractice.activeStudyPlan`
- `leetcodePractice.activeProblemList`
- `leetcodePractice.activeListSource` (deprecated)
- `leetcodePractice.studyPlans`
- `leetcodePractice.problemLists`
- `leetcodePractice.showProblemLists`

---

## Example blocks

The **Run Examples** command runs `console.log(...)` (JS/TS) or `print(...)` (Python) lines and compares output to optional trailing comments.

**TypeScript/JavaScript:**
```typescript
// Expected: 4
console.log(twoSum([2, 7, 11, 15], 9));
```

**Python:**
```python
# Expected: [0, 1]
print(two_sum([2, 7, 11, 15], 9))
```

The extension parses these blocks, runs the file, and reports pass/fail. If the comment is missing, it only checks that the line runs without error.

---

## Chrome extension

The Chrome extension injects a **"Cursor"** button next to LeetCode problem links. Clicking it opens a `vscode://` URI that:

1. Opens Cursor/VS Code (if installed)
2. Launches the LeetCode Practice extension
3. Opens the problem in the extension’s webview

Ensure the extension is installed and the workspace has a `.leetcode` file.

---

## URI handler

The extension registers:

```
vscode://lcex.leetcode-practice/open/{slug}
```

Example: `vscode://lcex.leetcode-practice/open/two-sum` opens the Two Sum problem. The Chrome extension uses this to open problems from leetcode.com.

---

## Agent integration (Cursor)

When a `.ts`, `.js`, or `.py` solution file is active in a LeetCode workspace:

- **Make Runnable** — editor title bar (always available in Interview mode)
- **Hint** — editor title bar (hidden while **Interview mode** is active)
- **Explain My Code** — editor title bar when a selection exists; also in the **editor context menu** (right‑click). Asks for intuition, step‑by‑step dry run, and time/space complexity. Disabled in Interview mode.

Clicking a button opens the agent chat and sends the prompt (same mechanism as paste + submit). Configure text in `.leetcode`: `agentPromptMakeRunnable`, `agentPromptHint`, `agentPromptExplain`. Sensible defaults are built in if a field is omitted.

Problem context for Explain is taken from an open matching problem webview, or from the solution filename (`167.ts` → fetch by id, `two-sum.ts` → slug).

### Status bar (LeetCode workspace)

When `.leetcode` is present: **daily goal** progress (if set), **level / total XP**, and (during Interview mode) a **countdown** (click to stop).

---

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Package extension
npm run package

# Install locally
npm run install-extension
```

---

## Project structure

```
lcex/
├── src/
│   ├── extension.ts          # Entry point
│   ├── modules/
│   │   ├── Authentication.ts
│   │   ├── Database.ts
│   │   ├── ExampleRunner.ts   # Run example blocks
│   │   ├── InternalProvider.ts
│   │   ├── LeetCode.ts        # LeetCode API
│   │   ├── LeetcodeConfig.ts
│   │   ├── LeetcodeConfigEditor.ts
│   │   ├── ProblemsProvider.ts
│   │   ├── ProblemView.ts     # Problem webview
│   │   ├── ProblemTimer.ts
│   │   ├── Gamification.ts    # XP, levels, daily goals
│   │   ├── InterviewMode.ts   # Timed interview sessions
│   │   ├── TemplateEngine.ts  # Solution file templates
│   │   └── ...
│   ├── templates/             # EJS templates
│   │   ├── challenge.ejs
│   │   ├── compilation.ejs
│   │   ├── run.ejs
│   │   └── stats.ejs
│   └── utils/
├── chrome-extension/          # Chrome extension for "Open in Cursor"
├── icons/
├── themes/
└── package.json
```

---

## License

MIT
