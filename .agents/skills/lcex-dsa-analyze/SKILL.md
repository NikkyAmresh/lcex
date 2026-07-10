---
name: lcex-dsa-analyze
description: LeetCode solution analysis — scored review (1–10) for approach, time, space, code style; problem-relative; no forced optimization.
---

# DSA implementation analysis

They want **feedback on their current solution**: approach fit, complexity vs this problem, and code quality — with **numeric scores** so they can see where they stand.

## What this skill is **not**

- **Not** coaching-only hints — that is **lcex-dsa-hint** (`coaching` object).
- **Not** rewriting their whole file unless a tiny snippet fixes a clear bug.

## Principles

- Scores are **1–10** **relative to this problem’s** expectations (not global contests).
- If the approach is **already appropriate** and complexity is **in line with a sound solution**, give **high scores** and **short** suggestions. **Do not** push micro-optimizations or “clever” refactors.
- If the code is **correct and readable** for the constraints, **say so** and score accordingly — “works and passes” is **fine**; you do not need to invent weaknesses.
- Use `currentRating` on **Current** lines (`"good"` | `"avg"` | `"worst"`) in line with those scores.

## Chat reply (optional short preamble)

You may add **one or two** sentences. The **machine-readable** part must be the JSON block.

## LCX `.hint` — analysis keys only for this skill

When you update the file, **preserve** any existing `coaching` object unless the user asked to clear it.

```json
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
```

- **`score`** (and `readabilityScore` / `structureScore`): integers **1–10**. Include when you fill the matching section; omit if you truly cannot judge.
- **`currentRating`:** required when you fill a **Current** string for that block (same semantics as before: problem-relative).
- **Plain text** strings; big-O as `O(n)`, etc.
- Omit **Suggested** / **Suggestion** lines when there is nothing meaningful to add (especially when scores are high).

### Automation (required)

1. Resolve `<same-dir>/<id-or-slug>.hint`.
2. If file exists, **read** it, merge analysis keys, **keep** `coaching`.
3. **Write** merged JSON.
4. If write fails, ask the user to open **Notes** from the problem panel.

**In-editor:** **Ask agent — Analyze** clears analysis fields then runs this flow.
