# Known Issues & Deferred Bugs

Bugs surfaced by the 2026-05-02 reliability audit but deferred as low-priority.
Severity reflects user-visible impact, not code-quality concerns.

## Deferred (low-priority / edge-case)

### `HintEditorProvider` invalid-JSON banner — already escapes
- **File:** `src/modules/HintEditorProvider.ts:42`
- **Status:** False positive in the audit. `parsed.error` is already passed through `escapeHtmlPlain()` before being injected into the webview HTML, so a `<script>` in the file content cannot escape the `<p>` text node.
- **Action:** None. Re-verified.

### `ContestsProvider` cache write does not create parent dir
- **File:** `src/modules/ContestsProvider.ts` `writeCache()`
- **Symptom:** First-run on a clean install can silently fail to write the contest cache; the next call rebuilds in-memory and re-tries, so user-visible impact is one extra network call.
- **Mitigation deferred:** Add `fs.mkdirSync(dir, { recursive: true })` before `writeFileSync`. Low risk, low value — covered by the in-memory cache fallback today.

### `CompaniesProvider.problemsForCompany` does not bounds-check `data.problems[edge.i]`
- **File:** `src/modules/CompaniesProvider.ts`
- **Symptom:** A truncated/corrupt `companies.json` would crash the sidebar tree expansion. The dataset is a build artifact shipped with the extension and never user-mutated, so corruption is implausible in practice.
- **Mitigation deferred:** Add `if (idx < 0 || idx >= data.problems.length) continue;` at the dereference. Defensive only.

### Cache TTL race in `ensureIdToTitleMap`
- **File:** `src/extension.ts` (`LeetCodeFileDecorationProvider.ensureIdToTitleMap`)
- **Symptom:** When the 60s TTL expires and many files are decorated in the same tick, two parallel reads can both observe expiry and load the cache twice. Result: one extra disk read; no data corruption.
- **Mitigation deferred:** Coalesce concurrent loads behind an in-flight Promise.

### Unbounded exponent in `ConstraintParser.parseNumericToken`
- **File:** `src/modules/ConstraintParser.ts:38–48`
- **Symptom:** `Math.pow(10, N)` with N > 308 returns Infinity. LeetCode constraints never reach this magnitude, but a malformed problem statement could poison fuzzer/complexity bounds.
- **Mitigation deferred:** Cap exponent at 18 (covers `int64`).

### `String.fromCharCode` numeric entity in `ProblemView`
- **File:** `src/modules/ProblemView.ts` (decodeHtmlEntities, ~line 103)
- **Symptom:** Numeric HTML entities outside the BMP or in the surrogate range render as garbage. LeetCode does not emit these in practice.
- **Mitigation deferred:** Use `String.fromCodePoint` with `0..0x10FFFF` validation.

### `ProblemsProvider.setProblemStatus` fire-and-forget memento update
- **File:** `src/modules/ProblemsProvider.ts:48–65`
- **Symptom:** UI tree refresh fires before persistence completes — but VS Code mementos are journaled and the next read returns the in-flight value, so stale tree state has never been observed.
- **Mitigation deferred:** Make the function async + await `memento.update()`. Small refactor, no current bug.

### `ProblemsProvider.refresh` swallows cache `unlink` errors
- **Symptom:** Stale cache file persists if delete fails; next refresh just rewrites it.
- **Mitigation deferred:** Log to `Logger`. No user impact.

### `BugReviewStore` slices stderr at byte boundary
- **File:** `src/modules/Fuzzer.ts:181`
- **Symptom:** UTF-8 multibyte sequence at the 200-byte boundary may render as `?`.
- **Mitigation deferred:** Cosmetic only.

### `LcexFontInstall` updates fonts on size change only
- **Symptom:** Fonts with same size but different content do not refresh.
- **Mitigation deferred:** Fonts ship as build artifacts; size change is a sufficient signal in practice.

### Daily goal `target` accepts NaN/Infinity (was on the fix queue, now deferred to low-impact path)
- Validates `mode` but not `target`. Worst case: progress bar renders weird; no XP grant happens because XP grant logic compares against a number that is itself derived elsewhere.
- _Note:_ Re-evaluated mid-session — kept on fix queue as #16 because the daily-goal toast can multiply if `target=0`.

### `LcInterviewEditorProvider` setInterval "leak" — false positive
- **File:** `src/modules/LcInterviewEditorProvider.ts:322`
- **Status:** Audit claim was wrong. The `tick` interval is cleared in `webviewPanel.onDidDispose` at line 388. Each `resolveCustomTextEditor` call is bound to one panel lifecycle; reopening creates a new panel with its own tick that disposes properly.

## Notes
- All of the above are deferred, not abandoned. Re-open if user reports.
- For the addressed bugs, see commit history on `main` near the audit date.
