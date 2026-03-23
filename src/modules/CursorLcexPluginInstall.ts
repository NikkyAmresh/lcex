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
  const skillPath = path.join(PLUGIN_ROOT, "skills", "lcex-interview-generator", "SKILL.md");
  const metaPath = path.join(PLUGIN_ROOT, ".cursor-plugin", "plugin.json");
  const r1 = await writeIfDifferent(skillPath, SKILL_MD);
  const r2 = await writeIfDifferent(metaPath, PLUGIN_JSON);
  if (r1 !== "unchanged" || r2 !== "unchanged") {
    Logger.log(`Cursor LCX plugin: skill ${r1}, plugin.json ${r2} at ${PLUGIN_ROOT}`);
  }
}
