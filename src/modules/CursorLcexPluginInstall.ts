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
description: LeetCode DSA coaching — problem-only nudges; never reviews the user’s code; fills .hint coaching JSON with one-line hints; no full solution.
---

# DSA coaching (hints only)

They are practicing **one** LeetCode-style problem.

## Hard rules (read twice)

- **Never** analyze, summarize, quote, score, or pass judgment on their code, pasted snippet, or “what I tried so far” from an implementation. Treat attached code as **out of scope**—do not infer their approach from it.
- Hints come **only** from the **problem statement** (and generic patterns anyone could mention without seeing their file). Write like someone who has **not** opened their solution.
- **Not** the full answer: no complete program, no line-by-line algorithm that finishes the problem.

## What this skill is **not**

- **Not** implementation review — that is **lcex-dsa-analyze** (\`approach\` / \`efficiency\` / \`codeStyle\`).
- **Not** long paragraphs or multi-step coaching essays.

## Your job

Give **tiny** nudges: one **simple** idea per \`coaching\` field—**one short line** each (about one sentence max), plain language, immediately usable. Prefer a single clause over lists.

## Chat reply (optional short preamble)

At most **one** short sentence, or **none**. The **machine-readable** part must be the JSON block below.

## LCX \`.hint\` — \`coaching\` object only for this skill

When you update the file, **preserve** any existing \`approach\`, \`efficiency\`, and \`codeStyle\` keys unless the user explicitly asked to refresh everything. If the file does not exist yet, include only metadata + \`coaching\`.

\`version\` must be \`1\`. Strings are plain text; complexity only if it fits in one short line.

\`\`\`json
{
  "version": 1,
  "titleSlug": "problem-slug",
  "problemTitle": "Display Name",
  "coaching": {
    "breakdown": "Name the one object each answer must depend on.",
    "thinking": "Ask what you can reuse as you sweep once.",
    "pitfalls": "Watch empty input and duplicates.",
    "nextFocus": "Try mapping value → index before the second pass."
  },
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
\`\`\`

- Omit a \`coaching\` key if you have nothing for that slot (avoid \`N/A\` filler unless every slot would otherwise be empty).
- **Do not** fill \`approach\`, \`efficiency\`, or \`codeStyle\` in the same turn unless the user asked for a full refresh.

### Automation (required after coaching)

1. Resolve \`<same-dir>/<id-or-slug>.hint\` (same basename as the solution file).
2. If a file exists, **read** it, merge your \`coaching\` (and \`updatedAt\`), keep analysis keys.
3. **Write** the merged JSON with the \`write\` tool.
4. If write fails, ask the user to open **Notes** from the problem panel and try again.

**Re-open:** **LeetCode: Open solution notes (.hint)**. **Reopen Editor With… → Text Editor** edits raw JSON.
`;

const DSA_ANALYZE_SKILL_MD = `---
name: lcex-dsa-analyze
description: LeetCode solution analysis — scored review (1–10) for approach, time, space, code style; problem-relative; no forced optimization.
---

# DSA implementation analysis

They want **feedback on their current solution**: approach fit, complexity vs this problem, and code quality — with **numeric scores** so they can see where they stand.

## What this skill is **not**

- **Not** coaching-only hints — that is **lcex-dsa-hint** (\`coaching\` object).
- **Not** rewriting their whole file unless a tiny snippet fixes a clear bug.

## Principles

- Scores are **1–10** **relative to this problem’s** expectations (not global contests).
- If the approach is **already appropriate** and complexity is **in line with a sound solution**, give **high scores** and **short** suggestions. **Do not** push micro-optimizations or “clever” refactors.
- If the code is **correct and readable** for the constraints, **say so** and score accordingly — “works and passes” is **fine**; you do not need to invent weaknesses.
- Use \`currentRating\` on **Current** lines (\`"good"\` | \`"avg"\` | \`"worst"\`) in line with those scores.

## Chat reply (optional short preamble)

You may add **one or two** sentences. The **machine-readable** part must be the JSON block.

## LCX \`.hint\` — analysis keys only for this skill

When you update the file, **preserve** any existing \`coaching\` object unless the user asked to clear it.

\`\`\`json
{
  "version": 1,
  "titleSlug": "problem-slug",
  "problemTitle": "Display Name",
  "approach": {
    "current": "Pattern you see; what their code is doing.",
    "suggested": "Only if something is off — optional lever, not a full walkthrough.",
    "keyIdea": "One crisp sentence on the main gap or strength.",
    "currentRating": "good",
    "score": 8
  },
  "efficiency": {
    "time": {
      "current": "e.g. O(n log n)",
      "suggested": "Target for this problem if different",
      "suggestion": "One lever if useful; else omit",
      "currentRating": "good",
      "score": 8
    },
    "space": {
      "current": "e.g. O(n)",
      "suggested": "Typical optimal/acceptable",
      "suggestion": "Optional",
      "currentRating": "avg",
      "score": 7
    }
  },
  "codeStyle": {
    "readability": "Brief + one reason if not great",
    "structure": "Brief + one reason if relevant",
    "suggestions": "One optional tweak — skip if code is already clear",
    "readabilityScore": 8,
    "structureScore": 7
  },
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
\`\`\`

- **\`score\`** (and \`readabilityScore\` / \`structureScore\`): integers **1–10**. Include when you fill the matching section; omit if you truly cannot judge.
- **\`currentRating\`:** required when you fill a **Current** string for that block (same semantics as before: problem-relative).
- **Plain text** strings; big-O as \`O(n)\`, etc.
- Omit **Suggested** / **Suggestion** lines when there is nothing meaningful to add (especially when scores are high).

### Automation (required)

1. Resolve \`<same-dir>/<id-or-slug>.hint\`.
2. If file exists, **read** it, merge analysis keys, **keep** \`coaching\`.
3. **Write** merged JSON.
4. If write fails, ask the user to open **Notes** from the problem panel.

**In-editor:** **Ask agent — Analyze** clears analysis fields then runs this flow.
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
  const dsaAnalyzeSkillPath = path.join(PLUGIN_ROOT, "skills", "lcex-dsa-analyze", "SKILL.md");
  const metaPath = path.join(PLUGIN_ROOT, ".cursor-plugin", "plugin.json");
  const r1 = await writeIfDifferent(interviewSkillPath, SKILL_MD);
  const r2 = await writeIfDifferent(dsaHintSkillPath, DSA_HINT_SKILL_MD);
  const r4 = await writeIfDifferent(dsaAnalyzeSkillPath, DSA_ANALYZE_SKILL_MD);
  const r3 = await writeIfDifferent(metaPath, PLUGIN_JSON);
  if (r1 !== "unchanged" || r2 !== "unchanged" || r3 !== "unchanged" || r4 !== "unchanged") {
    Logger.log(
      `Cursor LCX plugin: interview ${r1}, dsa-hint ${r2}, dsa-analyze ${r4}, plugin.json ${r3} at ${PLUGIN_ROOT}`
    );
  }
}
