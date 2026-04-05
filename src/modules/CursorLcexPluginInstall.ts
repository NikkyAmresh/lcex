import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Logger from "./Logger";

const PLUGIN_ROOT = path.join(os.homedir(), ".cursor", "plugins", "local", "lcex-leetcode-practice");

const SKILL_MD = `---
name: lcex-interview-generator
description: Generate JSON for LeetCode Practice .lcInterview files (timed mock interviews with LeetCode slugs).
---

# LC Interview file generator

When this skill is loaded, help the user design a **LeetCode Practice** mock interview and output **one JSON object** only (no surrounding explanation outside the code block).

## Output format

Return a single fenced \`\`\`json code block containing:

\`\`\`json
{
  "version": 1,
  "name": "Short label for the session",
  "durationMinutes": 45,
  "problems": [
    { "titleSlug": "two-sum", "difficulty": "EASY" },
    { "titleSlug": "add-two-numbers", "difficulty": "MEDIUM" }
  ]
}
\`\`\`

## Rules

- \`version\` must be \`1\`.
- \`name\`: short string (e.g. topic or date).
- \`durationMinutes\` must be exactly **45**, **60**, or **180**.
- \`problems\`: non-empty array. Each item has:
  - \`titleSlug\`: valid LeetCode **title slug** (kebab-case, e.g. \`binary-search\`), not display title.
  - \`difficulty\`: **EASY**, **MEDIUM**, or **HARD** (uppercase).
- Use real LeetCode slugs. If unsure of a slug, prefer well-known problems or say you need the user to confirm slugs.
- Do not include fields outside this schema. No comments inside JSON.

## User intent

If the user specifies topics (e.g. graphs, DP), pick a coherent set of slugs and mix difficulties reasonably for a mock interview. Respect requested problem count and duration when given.
`;

const DSA_HINT_SKILL_MD = `---
name: lcex-dsa-hint
description: LeetCode DSA hints in a structured Analysis-style format—no full solution.
---

# DSA hints (LeetCode-style analysis)

They are practicing one problem and may share code or what they tried.

## Rules

- **Never** give the full answer: no working solution code, no step-by-step algorithm that fully solves the problem. Hints only.
- Prefer their **current** approach. If it cannot work, say that in **one** sentence in **Approach → Key idea**, then point to what class of fix is needed—still no solution.
- Use the **exact section order and headings** below every time you give a hint or review their attempt. Keep each bullet **short** (one line or two); do not pad with filler.

## Output format (required)

Use this skeleton. Omit a subsection only if there is nothing useful to say (e.g. no code shared → skip **Code style** or mark as N/A briefly).

### Approach

- **Current:** Name the pattern you see (e.g. heap, greedy, linear scan, DP). One short comment on what the solution is doing or trying.
- **Suggested:** What direction would fix or improve it (still a hint—no full algorithm).
- **Key idea:** One crisp sentence—the main insight or fix to try next.

### Efficiency

**Time complexity**

- **Current:** Best characterization of what they have (e.g. \\(O(k \\cdot n)\\), \\(O(n^2)\\)). Use big-O; say "unknown" if you cannot tell.
- **Suggested:** What the usual target is for a good approach on this problem (still not a full walkthrough).
- **Suggestion:** One concrete lever (e.g. "replace the inner linear max with a max-heap")—not code.

**Space complexity**

- **Current:** e.g. \\(O(n)\\), \\(O(1)\\) extra, or "unknown".
- **Suggested:** What a typical optimal or acceptable solution uses.
- **Suggestion:** One line (e.g. "indexing by capital in-place vs. extra structure tradeoff") if it helps.

### Code style

- **Readability:** Brief rating or label (e.g. Good / Mixed / Needs work) plus **one** reason if not excellent.
- **Structure:** Same—rating + **one** reason if relevant.
- **Suggestions:** **One** actionable refactor (e.g. "collapse nested loops into a dual-heap flow so selection is one place")—not a rewrite of their file.

## Tone

- Sound like concise LeetCode **Analysis** feedback: direct, structured, technical.
- Still **one focused reply** per turn: the template keeps you organized; it is not an excuse to dump a full editorial.

## LCX \`.hint\` file — **JSON only** (no markdown blob)

The file next to the solution (e.g. \`2813.hint\`) is **valid JSON**. The Analysis editor shows one scrollable view (Approach → Efficiency → Code style). **Reopen Editor With… → Text Editor** edits raw JSON.

\`version\` must be \`1\`. Use **only** these keys (omit empty objects):

\`\`\`json
{
  "version": 1,
  "titleSlug": "problem-slug",
  "problemTitle": "Display Name",
  "approach": {
    "current": "…",
    "suggested": "…",
    "keyIdea": "…",
    "currentRating": "good"
  },
  "efficiency": {
    "time": {
      "current": "…",
      "suggested": "…",
      "suggestion": "…",
      "currentRating": "avg"
    },
    "space": {
      "current": "…",
      "suggested": "…",
      "suggestion": "…",
      "currentRating": "good"
    }
  },
  "codeStyle": {
    "readability": "…",
    "structure": "…",
    "suggestions": "…"
  },
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
\`\`\`

- **\`currentRating\` (required when you fill the matching \`current\` line):** \`"good"\` | \`"avg"\` | \`"worst"\`. **You** judge against **this problem’s** expectations — not by comparing raw big-O strings. Examples: on a full \`n×n\` matrix DP, \`O(n²)\` time may be **\`good\`**; the same bound can be **\`worst\`** on a different problem where \`O(n)\` is achievable. Set \`approach.currentRating\` for the approach **Current** line; set \`efficiency.time.currentRating\` and \`efficiency.space.currentRating\` for those **Current** lines. Omit only if there is no \`current\` text for that block.
- Write **plain text** in strings. For big-O use \`O(n)\`, \`O(1)\`, etc.
- **Do not** put a top-level \`markdown\` field; legacy files may still migrate once when opened.

### Automation (required after every hint)

1. Resolve \`<same-dir>/<id-or-slug>.hint\` (same basename as the solution file).
2. **Write** the **full** JSON with the \`write\` tool — create or **replace** the entire file (include \`currentRating\` fields as above).
3. If write fails, ask the user to open **Analysis** in the problem panel and try again.

**File icon:** **File Icon Theme** → **LeetCode Practice** for \`.hint\` icons.

**Re-analyze** clears hint fields and runs **Ask Agent – Hint** again.
`;

const PLUGIN_JSON = `{
  "name": "lcex-leetcode-practice",
  "displayName": "LeetCode Practice (LCX)",
  "description": "Cursor skills for LeetCode Practice extension"
}
`;

async function writeIfDifferent(filePath: string, content: string): Promise<"created" | "updated" | "unchanged"> {
  try {
    const existing = await fs.readFile(filePath, "utf-8");
    if (existing === content) return "unchanged";
    await fs.writeFile(filePath, content, "utf-8");
    return "updated";
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return "created";
  }
}

export async function ensureCursorLcexPluginInstalled(_context: vscode.ExtensionContext): Promise<void> {
  const interviewSkillPath = path.join(PLUGIN_ROOT, "skills", "lcex-interview-generator", "SKILL.md");
  const dsaHintSkillPath = path.join(PLUGIN_ROOT, "skills", "lcex-dsa-hint", "SKILL.md");
  const metaPath = path.join(PLUGIN_ROOT, ".cursor-plugin", "plugin.json");
  const r1 = await writeIfDifferent(interviewSkillPath, SKILL_MD);
  const r2 = await writeIfDifferent(dsaHintSkillPath, DSA_HINT_SKILL_MD);
  const r3 = await writeIfDifferent(metaPath, PLUGIN_JSON);
  if (r1 !== "unchanged" || r2 !== "unchanged" || r3 !== "unchanged") {
    Logger.log(
      `Cursor LCX plugin: interview skill ${r1}, dsa-hint skill ${r2}, plugin.json ${r3} at ${PLUGIN_ROOT}`
    );
  }
}
