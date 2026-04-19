# LeetCode Practice

Practice LeetCode problems directly in **VS Code** or **Cursor**. The extension fetches problems from LeetCode (or an optional internal API), generates **TypeScript**, **JavaScript**, or **Python** solution files with example test cases, runs examples inline or in a terminal, and gives you sidebars for the full problemset, study plans, curated problem lists, and Question of the Day. You can sign in to sync with your account, track progress locally (solved / attempting, streaks, XP, levels, daily goals), run **timed interview mode** or **planned mock interviews** from `.lcInterview` files, and use **Focus mode** for a minimal UI. A **Chrome extension** adds one-click “open in editor” from leetcode.com via a `vscode://` URI.

---

## Table of contents

1. [Features (overview)](#features-overview)
2. [Sidebar views](#sidebar-views)
3. [Command reference](#command-reference)
4. [LC Interview plans and reports](#lc-interview-plans-and-reports)
5. [Interview marking, scoring, and persistence](#interview-marking-scoring-and-persistence)
6. [Rewards (XP, levels, streaks)](#rewards-xp-levels-streaks)
7. [Zen mode, Focus layout, and Cursor skill](#zen-mode-focus-layout-and-cursor-skill)
8. [Keyboard shortcuts](#keyboard-shortcuts)
9. [Themes, languages, and custom editors](#themes-languages-and-custom-editors)
10. [Prerequisites](#prerequisites)
11. [Installation](#installation)
12. [Quick start](#quick-start)
13. [Configuration](#configuration)
14. [Example blocks](#example-blocks)
15. [Chrome extension](#chrome-extension)
16. [URI handler](#uri-handler)
17. [Agent integration (Cursor)](#agent-integration-cursor)
18. [Development](#development)
19. [Project structure](#project-structure)
20. [License](#license)

---

## Features (overview)

### Workspace and discovery

- **`.leetcode` marker** — A JSON config file in the workspace root (or a subfolder) turns on LeetCode features and can override VS Code settings for that workspace.
- **Problem browser** — Full LeetCode problemset in the sidebar (after sign-in), with refresh, difficulty filter, and search.
- **Study plans** — Sidebar listing problems for plans you configure (default includes Top Interview 150); **Switch Study Plan** picks the active plan.
- **Problem lists** — Separate sidebar for LeetCode **favorite question lists** (`/problem-list/<slug>/`); **Switch Problem List** picks the active list.
- **Question of the Day** — Dedicated view; refresh from the view toolbar; `qotdMonths` controls how much history loads (see [Configuration](#configuration)).

### Solutions and problem UI

- **Solution file generation** — From the problem webview, create files named by numeric **id** or **slug** (e.g. `167.ts`, `two-sum.ts`, `167.py`) using EJS templates and your chosen language.
- **Problem webview** — Read the statement, use **Create File**, **Run** / **Solve**-style actions, optional **Focus** chrome when Focus mode is on.
- **Example runner** — **LeetCode: Run Examples** executes `console.log` / `print` lines and compares output to `// Expected:` / `# Expected:` comments when present.
- **Run in terminal** — **LeetCode: Run in Terminal** runs the current solution with `npx --yes tsx` (TypeScript), `node` (JavaScript), or `python3` (Python), depending on language.

### Account and data

- **Sign in / Sign out** — LeetCode session for problemset and related data.
- **Refresh Problems** — Reloads problemset and study-plan-related caches.
- **Internal API** — Optional `internalApiUrl` (VS Code setting or `.leetcode`) to fetch problem metadata from your own backend instead of LeetCode.

### Progress and gamification

- **Status** — Mark problems **Solved**, **Attempting**, or **Clear** from the sidebar (right-click on a problem).
- **Stats webview** — **LeetCode: View Stats** shows solved/attempting counts, activity over time, streak, XP and level, daily goal progress, and interview session history.
- **Streak and XP** — Local streak from solve dates; XP on first solve per problem (by difficulty); level derived from total XP. Details: [Rewards (XP, levels, streaks)](#rewards-xp-levels-streaks).
- **Daily goals** — **LeetCode: Set Daily Goal** for problems per day and/or practice minutes per day; progress appears on the stats page and in the status bar (tracking only — no XP for completing the goal).
- **Refresh Stats Data** — Clears cached difficulty data used for stats and reloads.

### Interview workflows

- **Interview mode (ad hoc)** — **Interview Mode — Start** starts a timed session (45 / 60 / 180 minutes), optional manual slug list, strict webview (no hint/explain), session logging and bonus XP on stop. **Interview Mode — Stop** ends the session.
- **Planned mock interviews (`.lcInterview`)** — JSON plans with a fixed duration and ordered problem slugs; custom editor with **Start interview** / **End interview**, per-attempt **`.lcireport`** files, and **past attempts** list. See [LC Interview plans and reports](#lc-interview-plans-and-reports) and [Interview marking, scoring, and persistence](#interview-marking-scoring-and-persistence).
- **AI-assisted plan generation** — **LeetCode: Generate LC Interview (AI)** opens the agent with instructions to use the **lcex-interview-generator** skill and emit `.lcInterview` JSON.

### Editor and UI polish

- **Focus mode** — Uses VS Code **Zen Mode** plus closed sidebar/panel and maximized editor group; optional compact problem webview chrome. **Focus Mode (exit)** reverses those toggles **best effort**. See [Zen mode, Focus layout, and Cursor skill](#zen-mode-focus-layout-and-cursor-skill). Exiting can grant small participation XP (see [Rewards](#rewards-xp-levels-streaks)).
- **LeetCode Dark theme** — **LeetCode: Apply Theme** or `theme: "auto"` in `.leetcode` applies the bundled dark theme when the marker exists.
- **File icon theme** — **LeetCode Practice** icon theme in `package.json` (enable from **File → Preferences → File Icon Theme**).

### Cursor / agent and browser

- **Ask Agent** — **Make Runnable**, **Hint**, and **Explain My Code** (with selection) from the editor title bar; Explain also appears in the editor context menu. Prompts are configurable in `.leetcode`. **Hint** and **Explain** are disabled during Interview mode; **Make Runnable** stays available.
- **Chrome extension** — Injects a control on leetcode.com to open the current problem via the extension’s URI handler.

---

## Sidebar views

All of these live under the **LeetCode** activity bar container. Each view is shown only when the workspace has a `.leetcode` marker **and** the corresponding flag is true (via `.leetcode` or defaults).

| View | ID (internal) | Purpose |
|------|----------------|---------|
| **LeetCode** | `leetcode-practice.problemsView` | Full problemset (requires sign-in for data). Toolbar: **Filter by Difficulty**, **Search Problems**. |
| **Study Plans** | `leetcode-practice.topInterview150View` | Active study plan’s problems. Toolbar: filter, search, **Switch Study Plan**, **Refresh** (via command palette). |
| **Problem Lists** | `leetcode-practice.problemListsView` | Active problem list. Toolbar: filter, search, **Switch Problem List**. |
| **Question of the Day** | `leetcode-practice.qotdView` | Daily challenges. Toolbar: **Refresh Question of the Day**. |

**Right-click** on items in any of these views: **Mark as Solved**, **Mark as Attempting**, **Clear Status**.

---

## Command reference

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `LeetCode` to filter. Titles below match `package.json` **title** fields (verified against the current manifest).

| Command title | Command ID | What it does |
|---------------|------------|----------------|
| **LeetCode: Open/Create Problem** | `leetcode-practice.openProblem` | Prompt for problem id or slug; opens webview and can create the solution file. |
| **LeetCode: Open Question of the Day** | `leetcode-practice.openQotd` | Fetches today’s daily challenge and opens it. |
| **LeetCode: Run Examples** | `leetcode-practice.runExamples` | Runs example `console.log` / `print` blocks in the active solution file. |
| **LeetCode: Run in Terminal (ts-node)** | `leetcode-practice.runInTerminal` | Runs the whole solution file in an integrated terminal (`tsx` / `node` / `python`). |
| **LeetCode: Sign In** | `leetcode-practice.signIn` | LeetCode authentication flow. |
| **LeetCode: Sign Out** | `leetcode-practice.signOut` | Clears session. |
| **LeetCode: Refresh Problems** | `leetcode-practice.refreshProblems` | Refreshes problemset / study plan data caches. |
| **LeetCode: Refresh Question of the Day** | `leetcode-practice.refreshQotd` | Refreshes QOTD list for the sidebar. |
| **Mark as Solved** | `leetcode-practice.markAsSolved` | Sidebar context: mark selected problem solved. |
| **Mark as Attempting** | `leetcode-practice.markAsAttempting` | Sidebar context: mark attempting. |
| **Clear Status** | `leetcode-practice.clearProblemStatus` | Sidebar context: clear local status. |
| **LeetCode: Filter by Difficulty** | `leetcode-practice.filterByDifficulty` | Filter Easy / Medium / Hard (problemset, study plan, or problem list view). |
| **LeetCode: Search Problems** | `leetcode-practice.searchProblems` | Search by title or slug (same views as filter). |
| **LeetCode: Open Random Problem** | `leetcode-practice.openRandomProblem` | Picks randomly from unsolved problems in the main problem list; if every problem is solved, picks from the full list. |
| **LeetCode: View Stats** | `leetcode-practice.viewStats` | Opens stats webview (also used from XP status bar click). |
| **LeetCode: Refresh Stats Data** | `leetcode-practice.refreshStatsData` | Invalidates stats-related problemset cache and reloads. |
| **LeetCode: Apply Theme** | `leetcode-practice.applyTheme` | Applies **LeetCode Dark** when `.leetcode` exists. |
| **LeetCode: Switch Study Plan** | `leetcode-practice.switchStudyPlan` | Pick another configured study plan. |
| **LeetCode: Switch Problem List** | `leetcode-practice.switchProblemList` | Pick another configured problem list. |
| **LeetCode: Ask Agent – Make Runnable** | `leetcode-practice.agentMakeRunnable` | Opens agent chat with the make-runnable prompt + context. |
| **LeetCode: Ask Agent – Hint** | `leetcode-practice.agentHint` | Opens agent chat with hint prompt (hidden in Interview mode). |
| **LeetCode: Ask Agent – Explain My Code** | `leetcode-practice.agentExplainCode` | Sends explain prompt with editor selection (hidden in Interview mode). |
| **LeetCode: Focus Mode (enter)** | `leetcode-practice.focusModeEnter` | Enters focus layout + compact webview behavior. |
| **LeetCode: Focus Mode (exit)** | `leetcode-practice.focusModeExit` | Exits focus layout. |
| **LeetCode: Set Daily Goal** | `leetcode-practice.setDailyGoal` | Set or clear daily problems / minutes goals. |
| **LeetCode: Interview Mode — Start** | `leetcode-practice.interviewModeStart` | Start ad hoc timed interview session. |
| **LeetCode: Interview Mode — Stop** | `leetcode-practice.interviewModeStop` | Stop session and persist stats. |
| **LeetCode: Generate LC Interview (AI)** | `leetcode-practice.interviewGenerateWithAi` | Prompts for interview name; opens agent with skill instructions to produce `.lcInterview` JSON. |
| **LeetCode: Open LC Interview Report…** | `leetcode-practice.openLcInterviewReportFile` | File picker for `*.lcireport`; opens the report in the custom report viewer. |

**Note:** `leetcode-practice.openLcInterviewReportForPath` is registered for internal use (e.g. opening a report path from the LC Interview editor) and is **not** listed in the Command Palette manifest.

---

## LC Interview plans and reports

### `.lcInterview` (version 1)

JSON files with extension `.lcInterview` (case variants supported) describe a **named** mock interview:

- **`version`**: `1`
- **`name`**: Display name; used to name a folder for report files
- **`durationMinutes`**: `45`, `60`, or `180`
- **`problems`**: Array of `{ "titleSlug": "leetcode-slug", "difficulty": "EASY" | "MEDIUM" | "HARD" }` (strings are also accepted as slugs with default difficulty)
- **`attempts`** (optional): `{ "id": "3 lowercase hex chars", "time": "ISO-8601" }` — tracks past runs and links to reports

Opening the file uses the **LC Interview** custom editor: plan summary, **Start interview** (runs the same timed session machinery as ad hoc mode but tied to this file), **End interview**, optional **past attempts** buttons that open `report-{id}.lcireport` when the file exists. While a session from this file is active, problem rows open in the problem webview.

### `.lcireport` (version 1)

After a session ends, a snapshot is written under:

`<parent-of-.lcInterview>/<sanitized-interview-name>/report-<attemptId>.lcireport`

The **LC Interview Report** custom editor renders the session summary (timing, planned vs solved slugs, XP breakdown, etc.). **LeetCode: Open LC Interview Report…** lets you open any `*.lcireport` file from disk.

---

## Interview marking, scoring, and persistence

During an active interview session, the problem webview runs in **interview mode** (difficulty tags and some chrome are toned down; agent **Hint** / **Explain** are disabled). How a problem is recorded depends on which control you use.

### Buttons in the problem webview

| Control | Effect |
|--------|--------|
| **Solve** | Opens or creates your local solution file only. Does not change solved status or interview scoring. |
| **Mark as solved** | Updates **practice** status to solved in the sidebar, awards **first-solve XP** (once per slug, by difficulty), **records the slug for the current interview session**, and pauses the per-problem timer. Hidden once the problem is already marked solved in practice. |
| **Mark solved (this interview)** | Shown only in interview mode while that problem is not yet counted for the session. Adds the slug to the session’s solved list **only** — it does **not** set practice “solved” and does **not** grant first-solve XP by itself. Use this when you finished the problem in the mock but do not want to mark it solved in your long-term practice log yet. |

**Mark as solved** and **Mark solved (this interview)** both call the same underlying session tracker, but only the first path updates practice status and runs the first-solve XP hook (`handleProblemSolved` in the extension). The same slug is only stored once per session (duplicates are ignored).

### Interview bonus XP (when the session ends)

When the timer expires or you run **Interview Mode — Stop**, the extension:

1. Computes **interview bonus XP** from problems that were **both planned for this session and** listed in the session’s solved list:
   - **Easy** → 10 XP, **Medium** → 20, **Hard** → 40 (same curve as first-solve XP in `Gamification.ts`).
2. Adds **+30 perfect-set bonus** if **every** planned problem appears in the session solved list.
3. If nothing was marked solved in the session, total interview bonus XP is **0**.

Only **planned** slugs contribute to that bonus. Extra slugs recorded in the session (for example if something unexpected were added) do not earn interview XP, but they can still increase the stored `solvedCount` on the history entry.

Bonus XP is applied to your **total XP** (`addBonusXp`) when the session ends. You also see a notification such as `Interview ended · +N bonus XP`.

### Time on problem

While a session is active, a background tick (once per second) adds elapsed time to whichever problem is **focused** — the slug for the problem webview you last opened from the interview flow (`interviewFocusSlug`). Those per-problem seconds appear on the end-of-session report and in **View Stats** history rows where applicable.

### Where results are stored

| Source | Session history (stats) | On-disk `.lcireport` |
|--------|---------------------------|----------------------|
| **Ad hoc** interview (setup panel: random mix or custom slugs) | **Yes** — appended to global interview history (last **50** sessions) shown under **LeetCode: View Stats** | **No** — the summary webview opens, but no report file is written (there is no `.lcInterview` path or attempt folder). |
| **`.lcInterview` → Start interview** | **Yes** — same history | **Yes** — `report-<attemptId>.lcireport` under `<folder-containing-.lcInterview>/<sanitized-interview-name>/`. The `.lcInterview` file is updated with a new `attempts[]` entry (3-digit hex id + timestamp) when you start. |

A legacy code path can also write under `~/.lcex/<md5-of-interview-path>.lcireport` when a session is tied to a source interview file but does not use the per-attempt folder layout; **planned** flows from the LC Interview editor use the folder + `report-*.lcireport` layout described above.

---

## Rewards (XP, levels, streaks)

All XP is **local** (VS Code / Cursor `globalState`). It is not sent to LeetCode. **LeetCode: View Stats** and the **status bar** (level · total XP) show the same totals.

### Ways you earn XP

| Source | Amount | When |
|--------|--------|------|
| **First solve** | **10** (Easy), **20** (Medium), **40** (Hard), **15** if difficulty is unknown | Once **per problem slug**, the first time you mark it **solved** in practice — from the problem webview **Mark as solved** or the sidebar **Mark as Solved**. Does **not** re-award if you clear status and mark again. |
| **Interview bonus** | Sum of the same Easy/Medium/Hard values for each **planned** problem you marked solved **in that session**, plus **+30** if you cleared **all** planned problems in the session | When the interview ends (timer or **Interview Mode — Stop**). **0** if you solved nothing in the session. See [Interview marking…](#interview-marking-scoring-and-persistence). |
| **Focus participation** | **+10** | When **Focus mode** workbench UI is torn down (`exitFocusModeUi` — e.g. **Focus Mode (exit)**, or **Interview Mode — Stop**, which also exits that layout). At most once per **60 minutes** per machine (cooldown stored in global state). |

**Mark solved (this interview)** alone does not grant first-solve XP; use **Mark as solved** when you want the one-time slug reward.

### Levels

Levels are derived only from **total XP** (`xpLevelProgress` in `Gamification.ts`):

- You start at **level 1** with **0** XP.
- To advance from level **L** to **L + 1**, you need **100 × L** XP in that level (100 to reach level 2, then 200 more for level 3, then 300 more for level 4, …).

The status bar shows **Lv N · total XP**; hover shows progress within the current level.

### Streak

The **streak** on the stats page is **not** XP. It counts **consecutive calendar days** (UTC date of `solvedAt`) on which you had at least one problem marked **solved**. The latest solved day must be **today** or **yesterday** for the streak to be non-zero; then it walks backward day-by-day while each previous day also has a solve.

### Daily goals

**LeetCode: Set Daily Goal** tracks **problems solved today** or **practice minutes today** (from the per-problem timer). Meeting the goal is **display only** — no extra XP.

---

## Zen mode, Focus layout, and Cursor skill

### Zen mode vs Focus Mode

**Zen Mode** is the editor’s built-in minimal layout (centered editor, chrome reduced — see **View → Appearance → Zen Mode** in VS Code / Cursor). **LeetCode: Focus Mode (enter)** is an extension workflow that:

1. Closes the **sidebar** and **panel** (`workbench.action.closeSidebar`, `workbench.action.closePanel`).
2. **Toggles Zen Mode on** (`workbench.action.toggleZenMode`).
3. **Toggles maximized editor group** (`workbench.action.toggleMaximizeEditorGroup`).
4. Enables **compact** problem webview chrome (`FOCUS_COMPACT_WEBVIEW_KEY` in global state).
5. Sets workspace **`zenMode.hideStatusBar`** to **`false`** so the **status bar stays visible** (daily goal, level/XP, problem timer, interview countdown). Your previous `zenMode.hideStatusBar` value is saved in **workspace** storage and restored when focus layout exits.

**Interview Mode — Start** (ad hoc or from a `.lcInterview` file) uses the same **enter Focus** path, so interviews run in the same Zen-centered layout with a visible status bar.

**Focus Mode (exit)**, or stopping an interview (which calls the same teardown), restores `zenMode.hideStatusBar`, then runs **toggle** commands in order: maximize editor group, Zen Mode, panel, sidebar. If you changed the workbench manually while focused, those toggles may not return you to the exact prior state — the implementation is **best effort**.

### Cursor skill: `lcex-interview-generator`

When the extension **activates**, it tries to sync a **local Cursor plugin** (see `src/modules/CursorLcexPluginInstall.ts`) to:

`~/.cursor/plugins/local/lcex-leetcode-practice/`

Contents:

| Path | Purpose |
|------|---------|
| `skills/lcex-interview-generator/SKILL.md` | Agent skill: how to output a valid **version 1** `.lcInterview` JSON (`name`, `durationMinutes` 45/60/180, `problems[]` with `titleSlug` + `difficulty`). |
| `.cursor-plugin/plugin.json` | Plugin metadata (`lcex-leetcode-practice`). |

**LeetCode: Generate LC Interview (AI)** opens the agent with a prompt that tells you to **load the `lcex-interview-generator` skill** and emit the plan as JSON inside one fenced code block (tagged `json`), then save as `*.lcInterview`.

If the skill does not appear in Cursor, confirm the folder exists after loading the extension once; restart Cursor or reload the window if needed. The canonical skill text lives in the extension source (`CursorLcexPluginInstall.ts`), not as a separate tracked file in this repo root.

---

## Keyboard shortcuts

| Shortcut (macOS) | Shortcut (Windows/Linux) | Command |
|------------------|---------------------------|---------|
| `Cmd+Shift+R` | `Ctrl+Shift+R` | **LeetCode: Run in Terminal (ts-node)** |

---

## Themes, languages, and custom editors

| Contribution | Details |
|--------------|---------|
| **Color theme** | **LeetCode Dark** (`leetcode-dark`) — `themes/leetcode-dark-color-theme.json` |
| **File icon theme** | **LeetCode Practice** — `icons/leetcode-file-icon-theme.json` |
| **Language: LeetCode Config** | File name `.leetcode` |
| **Language: LC Interview** | Extensions `.lcInterview`, `.lcinterview` |
| **Language: LC Interview Report** | Extension `.lcireport` |
| **Custom editor: LeetCode Config** | Visual / structured editing for `.leetcode` |
| **Custom editor: LC Interview** | Webview UI for `.lcInterview` plans |
| **Custom editor: LC Interview Report** | Webview UI for `.lcireport` snapshots |

---

## Prerequisites

- **VS Code** or **Cursor** **1.85+**
- **Node.js** — for TypeScript/JavaScript execution
- **Python 3** — optional, for Python solutions
- For TypeScript files, the extension runs via **`npx --yes tsx`** (no global install required)

---

## Installation

### VS Code extension

1. Build and install locally:

   ```bash
   npm install
   npm run package
   code --install-extension leetcode-practice-0.1.0.vsix --force
   ```

2. Or use **Extensions → … → Install from VSIX** and select the built `.vsix`.

The version in the filename matches `"version"` in `package.json` (currently `0.1.0`). After a version bump, adjust the `code --install-extension` filename accordingly, or run **`npm run install-extension`** (see [Development](#development)).

### Chrome extension (optional)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `chrome-extension` folder in this repo

The manifest registers content scripts on `leetcode.com` / `www.leetcode.com` (`manifest_version` 3).

---

## Quick start

1. Create a folder for your LeetCode work.
2. Add a `.leetcode` file at the project root (see [Configuration](#configuration)).
3. Open the folder in VS Code or Cursor.
4. **LeetCode: Sign In** from the Command Palette.
5. Use the **LeetCode** activity bar: problemset, study plans, problem lists, QOTD.
6. Open a problem → **Create File** in the webview → solve → **Run Examples** or **`Cmd+Shift+R`** / **`Ctrl+Shift+R`** for a full file run.

---

## Configuration

### `.leetcode` (workspace)

Place a `.leetcode` JSON file in your project root (or a subfolder). It overrides VS Code settings and enables the extension UI.

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
  "agentPromptHint": "Load **lcex-dsa-hint** and follow it. Nudge from the problem only—do not read or review my code. Each `coaching` value: one short line; no solution.",
  "agentPromptExplain": "Explain my solution… (intuition, dry run, complexity)."
}
```

| Field | Description |
|-------|-------------|
| `studyPlans` | `{ slug, name }[]` — LeetCode study plan slugs (e.g. `top-interview-150`) |
| `problemLists` | `{ slug, name }[]` — Problem list slugs (`/problem-list/<slug>/`) |
| `activeStudyPlan` | Default study plan slug |
| `activeProblemList` | Default problem-list slug |
| `activeListSource` | Deprecated; migration helper when `activeProblemList` was unset |
| `theme` | `"auto"` \| `"leetcode-dark"` \| `"none"` |
| `defaultDirectory` | Relative directory for new solution files (`.` = workspace-relative) |
| `fileNamePattern` | `"id"` or `"slug"` for new filenames |
| `language` | `"typescript"` \| `"javascript"` \| `"python"` |
| `internalApiUrl` | Optional API base URL for problem data |
| `showProblemset` | Show the main **LeetCode** problemset view |
| `showStudyPlans` | Show **Study Plans** |
| `showProblemLists` | Show **Problem Lists** |
| `showQotd` | Show **Question of the Day** |
| `qotdMonths` | Months of QOTD history to load |
| `agentPromptMakeRunnable` | **Make Runnable** prompt |
| `agentPromptHint` | **Hint** prompt |
| `agentPromptExplain` | Base **Explain My Code** prompt (selection and problem context appended) |

You can edit `.leetcode` in the **LeetCode Config** custom editor by opening the file.

### VS Code `settings.json`

These keys can be overridden by `.leetcode` when both exist for the workspace:

- `leetcodePractice.defaultDirectory`
- `leetcodePractice.fileNamePattern` (`id` \| `slug`)
- `leetcodePractice.language` (`typescript` \| `javascript` \| `python`)
- `leetcodePractice.internalApiUrl`
- `leetcodePractice.activeStudyPlan`
- `leetcodePractice.activeProblemList`
- `leetcodePractice.activeListSource` (deprecated)
- `leetcodePractice.studyPlans`
- `leetcodePractice.problemLists`
- `leetcodePractice.showProblemLists` — when `false`, the Problem Lists sidebar view is hidden (other `show*` flags exist only in `.leetcode`; see defaults in `src/modules/LeetcodeConfig.ts`)

---

## Example blocks

**LeetCode: Run Examples** runs lines that call `console.log` (JS/TS) or `print` (Python) and compares stdout to an optional trailing expected-value comment.

**TypeScript / JavaScript:**

```typescript
// Expected: 4
console.log(twoSum([2, 7, 11, 15], 9));
```

**Python:**

```python
# Expected: [0, 1]
print(two_sum([2, 7, 11, 15], 9))
```

If the expected comment is omitted, the runner only checks that the line executes without error.

---

## Chrome extension

The content script adds a **Cursor** (open-in-editor) control next to LeetCode problem links. It opens:

`vscode://lcex.leetcode-practice/open/<slug>`

which activates this extension and opens the problem webview. Requires the VS Code/Cursor extension installed and a workspace with `.leetcode`.

---

## URI handler

Registered path shape:

```text
vscode://lcex.leetcode-practice/open/{slug}
```

Example: `vscode://lcex.leetcode-practice/open/two-sum` opens **Two Sum**. Implementation: `URI_OPEN_PREFIX = "/open/"` in `src/extension.ts`.

---

## Agent integration (Cursor)

For **mock interview JSON** generation, see [Cursor skill: `lcex-interview-generator`](#cursor-skill-lcex-interview-generator) and command **LeetCode: Generate LC Interview (AI)**.

In a LeetCode workspace, when a `.ts`, `.js`, or `.py` solution file is active **and** the file is recognized as a solution (LeetCode markers / context):

- **Make Runnable** — editor title (available even in Interview mode)
- **Hint** — editor title (disabled in Interview mode)
- **Explain My Code** — editor title when selection exists; also **editor context menu** (disabled in Interview mode)

The extension tries Cursor/VS Code chat commands with a prefilled prompt, then falls back to clipboard + open chat. Configure copy in `.leetcode` under `agentPromptMakeRunnable`, `agentPromptHint`, `agentPromptExplain`.

**Explain** uses an open matching problem webview if available, or infers the problem from the filename (`167.ts` → id, `two-sum.ts` → slug).

### Status bar

With `.leetcode` present: daily goal progress (if set), **level / XP**, and during Interview mode a **countdown** (click invokes stop where applicable).

---

## Development

| Script | Command | Purpose |
|--------|---------|---------|
| **Install deps** | `npm install` | Install `dependencies` and `devDependencies`. |
| **Compile** | `npm run compile` | `tsc -p ./` then **`npm run copy-assets`** (copies `src/templates/*.ejs` → `out/`). |
| **Copy assets only** | `npm run copy-assets` | EJS templates into `out` (usually invoked by `compile`). |
| **Watch** | `npm run watch` | `tsc -w -p ./` for iterative builds. |
| **Test** | `npm test` | `node --test --import tsx test/integration.test.ts` (integration test hits the network). |
| **Prepublish** | `npm run vscode:prepublish` | Runs `compile` before packaging for marketplace / vsce. |
| **Package** | `npm run package` | `compile` then `npx vsce package` → `leetcode-practice-<version>.vsix`. |
| **Install extension locally** | `npm run install-extension` | `package` then `code --install-extension leetcode-practice-0.1.0.vsix --force` (update version string in `package.json` / script if needed). |

**Checked in this repo:** `npm run compile` and `npm test` complete successfully (TypeScript build + integration test).

---

## Project structure

```text
lcex/
├── src/
│   ├── extension.ts              # Activation, commands, URI handler
│   ├── modules/
│   │   ├── Authentication.ts
│   │   ├── Database.ts
│   │   ├── ExampleRunner.ts
│   │   ├── InternalProvider.ts
│   │   ├── LeetCode.ts
│   │   ├── LeetcodeConfig.ts
│   │   ├── LeetcodeConfigEditor.ts
│   │   ├── LcInterviewEditorProvider.ts
│   │   ├── LcInterviewFile.ts
│   │   ├── ProblemsProvider.ts
│   │   ├── ProblemView.ts
│   │   ├── ProblemTimer.ts
│   │   ├── Gamification.ts
│   │   ├── InterviewMode.ts
│   │   ├── TemplateEngine.ts
│   │   ├── CursorLcexPluginInstall.ts   # Syncs lcex-interview-generator skill to ~/.cursor/...
│   │   └── ...
│   ├── templates/               # EJS (copied to out/)
│   └── utils/
├── chrome-extension/
├── icons/
├── themes/
├── test/
└── package.json
```

---

## License

MIT
