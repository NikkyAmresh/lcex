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
- **Progress tracking** — Mark problems as Solved or Attempting, view stats
- **LeetCode sign-in** — Sync with your LeetCode account for problemset data
- **LeetCode Dark theme** — Optional auto-apply when a workspace has `.leetcode`
- **Cursor/Agent integration** — "Make Runnable" and "Hint" buttons in the editor toolbar (when in a solution file)
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
| **LeetCode: View Stats** | View solved/attempting counts |
| **LeetCode: Apply Theme** | Apply LeetCode Dark theme if `.leetcode` exists |
| **LeetCode: Switch Study Plan** | Switch active study plan |
| **Mark as Solved** | Mark the selected problem as solved (right‑click) |
| **Mark as Attempting** | Mark as attempting (right‑click) |
| **Clear Status** | Clear status (right‑click) |
| **LeetCode: Ask Agent – Make Runnable** | Open agent chat with make-runnable prompt |
| **LeetCode: Ask Agent – Hint** | Open agent chat with hint prompt |

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
  "agentPromptHint": "Give me a hint for this problem. Do not give the solution."
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

- A **"Make Runnable"** button appears in the editor title bar
- A **"Hint"** button appears in the editor title bar

Clicking either opens the Cursor agent chat and pastes the configured prompt (`agentPromptMakeRunnable` or `agentPromptHint`). Defaults:

- **Make Runnable:** `Make this Runnable, do not give solution.`
- **Hint:** `Give me a hint for this problem. Do not give the solution.`

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
