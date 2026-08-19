---
name: lcex-interview-generator
description: Generate JSON for LeetCode Practice .lcInterview files (timed mock interviews with LeetCode slugs).
---

# LC Interview file generator

When this skill is loaded, help the user design a **LeetCode Practice** mock interview and output **one JSON object** only (no surrounding explanation outside the code block).

## Output format

Return a single fenced ```json code block containing:

```json
{
  "version": 1,
  "name": "Short label for the session",
  "durationMinutes": 45,
  "problems": [
    { "titleSlug": "two-sum", "difficulty": "EASY" },
    { "titleSlug": "add-two-numbers", "difficulty": "MEDIUM" }
  ]
}
```

## Rules

- `version` must be `1`.
- `name`: short string (e.g. topic or date).
- `durationMinutes` must be exactly **45**, **60**, or **180**.
- `problems`: non-empty array. Each item has:
  - `titleSlug`: valid LeetCode **title slug** (kebab-case, e.g. `binary-search`), not display title.
  - `difficulty`: **EASY**, **MEDIUM**, or **HARD** (uppercase).
- Use real LeetCode slugs. If unsure of a slug, prefer well-known problems or say you need the user to confirm slugs.
- Do not include fields outside this schema. No comments inside JSON.

## User intent

If the user specifies topics (e.g. graphs, DP), pick a coherent set of slugs and mix difficulties reasonably for a mock interview. Respect requested problem count and duration when given.
