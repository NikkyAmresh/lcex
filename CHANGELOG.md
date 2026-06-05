# Changelog

All notable changes to LeetCode Practice will be documented in this file.

## [0.10.0] Pattern Recognition Drill

### Added

- "LeetCode: Pattern Recognition Drill" command. Picks a random recognition-friendly problem, scrubs the pattern hints from the statement, and gives you up to five minutes to recall which algorithmic pattern you'd reach for before revealing the answer (derived for free from the problem's LeetCode topic tags). The pool is gated for clean grading: only problems mapping to 1-2 distinct patterns and with a community acceptance rate of at least 45% (difficulty itself is not a gate, so single/dual-pattern Mediums are included). Self-grade each one as got-it / got-some / missed; "Got some" gives half credit on multi-pattern problems. The header tracks running accuracy, partials, and your current/best streak. A "Solve this" button opens the actual problem if you want to go solve it. Drill history persists in global state. Needs the default LeetCode source (problems must carry topic tags).

## [0.9.0] Class-design templates + Open Solution shortcut

### Added

- Class-design problems (e.g. #295 Find Median from Data Stream, LRU Cache, Trie) now generate a runnable driver. The template detects the design class and emits an `_lcex_run` / `_lcexRun` helper plus one `print` / `console.log` call per example pair (`ops`, `args`), so Run Examples compares the result array against the expected `[null, ...]` output instead of trying to call `__init__([...])`.
- "LeetCode: Open Solution" command + editor-title icon on the plain-text problem view, so the solution file can be opened from the text view without going through the sidebar.

### Fixed

- Expected-output extraction now also matches the class-design HTML shape (`Output\n[null,...]` on a separate line), not just `Output: <val>`.
- `getTargetDir` falls back to the workspace root for non-`file` URIs (the plain-text problem view used to confuse path resolution).

## [0.8.1] Semantic example-output comparison

### Fixed

- Inline example runner no longer flags cosmetically different but semantically equal outputs as failures. Numeric values are compared as numbers (`2.00000` matches `2`), list/array whitespace is ignored (`[3, 4]` matches `[3,4]`), and Python-style literals match their JSON equivalents (`'()'` matches `"()"`, `True/False/None` match `true/false/null`). Genuine mismatches (e.g. `0.00000` vs `nan`, or numerically different values) still fail.

## [0.8.0] Interview setup modes

### Added

- Mock interview setup now supports three problem-source modes: pick by company, pick from a problem list, or pick from a study plan. Picker UI adapts to the selected mode.
- "End interview" button on the interview webview for ending a session without waiting for the timer.

## [0.7.4] Timer for non-TypeScript files

### Fixed

- Practice timer now activates for solution files in any supported language, not just TypeScript.

## [0.7.3] Reverse timer mode

### Added

- Optional reverse (countdown) mode for the practice timer.

### Fixed

- Problem list ordering preserved as configured rather than re-sorted.

## [0.7.2] String expected-output cleanup

### Fixed

- Default test-case comments strip surrounding quotes from string expected outputs so the inline comparison matches what `print` actually emits.

## [0.7.1] Inline expected-output comments

### Added

- Generated default test cases now include an inline `# Expected:` (or language equivalent) comment next to each call, so the example runner can compare without a separate expected block.

## [0.7.0] Sandboxed example runs

### Changed

- **On-save example runs are now sandboxed on macOS.** Saving a solution previously spawned `node` / `python3` / `g++` / `javac` / `java` against the file with the user's full network and filesystem access. The runner now wraps each invocation in `sandbox-exec` with a deny-default profile: no network, no writes outside the toolchain's scratch directories. Solutions still see stdout/stderr identically; the only behavioural change is that misbehaving code can no longer reach the network or modify files outside scratch.
- **New setting `leetcodePractice.runExamples.sandbox`** with values `auto` (default), `sandbox`, `off`. `auto` enables the sandbox on macOS and runs unsandboxed elsewhere. `sandbox` forces sandboxing (fails clearly on platforms without a backend). `off` restores the previous unsandboxed behaviour.
- **C++ build output moved to a temp directory.** `g++` now writes the compiled binary into `mktemp`'d scratch rather than the workspace, so the sandbox can deny workspace writes without breaking compile-and-run.
- **Python runs use `python3 -B`** to suppress `__pycache__` writes that would otherwise be denied by the sandbox.

### Notes

- When a run fails with a tell-tale syscall denial (EPERM, ENOTFOUND, ECONNREFUSED, etc.), the inline error includes a hint pointing to the `runExamples.sandbox` setting.
- TypeScript uses `npx --yes tsx`; if `tsx` is not already cached in `~/.npm`, the first sandboxed run will fail because npx needs network to install it. Pre-warm once with `npx tsx --version` outside the sandbox, or set `runExamples.sandbox` to `off`.

## [0.6.3] Reliability

Cloud config now refreshes on every activation rather than relying on a 24-hour
local cache, so server-side configuration changes take effect on the next reload.

## [0.6.2] Maintenance

Internal cleanup, no functional change versus 0.6.1.

## [0.6.1] Pattern Mastery fix

### Fixed

- **Pattern Mastery sidebar always showed `0 solved`.** Two bugs combining:
  1. The detector read source from the active text editor, but when "Mark as solved" is clicked from the problem webview the active editor often points at the wrong file (or none at all), so `recordSolveForPatterns` never ran.
  2. The tree view refreshed before pattern recording finished, so even successful records didn't appear until the next manual refresh.
- **Resolution:** the detector now resolves the canonical solution file for the marked problem, prefers an open document (so unsaved changes still count) and falls back to disk; mark-solved handlers await pattern recording before refreshing the tree, so counts update immediately. Falls back gracefully when the problem isn't in the in-memory cache by fetching once via the active provider.

## [0.6.0] — Java support

### Added

- **Java solution language.** New `.java` strategy alongside TypeScript / JavaScript / Python / C++.
  - `leetcodePractice.language` accepts `"java"`; problem webview "Create File" generates a `.java` from the LeetCode `class Solution { ... }` snippet, plus a `LCexMain` runner stub when no `public static void main` is present.
  - **Run examples / Run in terminal** compiles with `javac` to a temp dir, runs `java -cp <tmp> <EntryClass>`, where the entry class is whichever class declares `main`. Requires a JDK on PATH.
  - **Syntax highlighting:** `langJava` added to the curated shiki bundle.
  - **Interview lint** detects `System.out.println` debug calls and reuses the C++ parameter extractor for mutation/sort heuristics.
  - **Adversarial probes** + **complexity budget** + **AI-tab suppression** (`[java]` scope) wired through.
  - **Analytics** language bucket adds `"java"`.

### Not yet supported on Java

- Fuzzer, complexity fitter, recursion visualizer, iterative visualizer — gated with a "doesn't support Java yet" status message (parity with C++ phase-2 status).

## [0.5.1] — Companion Chrome extension

### Companion Chrome extension (`chrome-extension/`, v1.1.0)

Shipped separately from the VSIX; install from the `chrome-extension` folder if you use it.

- **DSA Portal (Brain) button** on LeetCode problem links opens `https://dsa-portal.algofunds.in/question/{slug}` in a new tab (alongside the existing Cursor deep-link control).
- **Cursor control** label shortened to `</>` so both buttons fit more cleanly in tight layouts.
- **Insertion logic** updated so the Brain button is added even when the Cursor control already exists (stable pairing per link).

## [0.5.0] — Pattern Mastery Map + reliability hardening

### Added

- **Pattern Mastery Map.** Rule-based detector for ~20 canonical interview patterns (e.g. two pointers, sliding window, BFS/DFS, DP top-down/bottom-up, backtracking, heap, trie, union-find, topological sort, monotonic stack, bit tricks, hash map, linked list, prefix sums, tree traversals). Each pattern keeps mastery state with **21-day half-life decay**.
- **Pattern Mastery sidebar.** Rank glyphs (strong → weak), a compact mastery bar, and a **suggested next** highlight; topic tags from GraphQL are used to relate patterns to problems.
- **Auto-credit on solve.** Completing a problem credits the active solution toward the detected patterns.
- **Commands:** `LeetCode: Practice Weakest Pattern`, `LeetCode: Pattern Mastery Summary`.
- **Tests:** `test/pattern-detector.test.ts` exercises major detectors and comment-stripping invariants.

### Changed / fixed

- **Safer file I/O:** Bug review store and `.lcireport` snapshots use atomic temp + rename writes.
- **Network resilience:** 15s timeouts on LeetCode GraphQL/HTTP calls; slug-by-ID fetch retries with backoff on 429/503 and clearer error logging.
- **Cloud sync:** Timeouts, guarded JSON parsing, and serialized merge handling in stats sync.
- **Path safety:** Target directory resolution rejects null bytes and unsafe workspace traversal.
- **Internal API provider:** Request timeout + JSON parse guards.
- **Example runner:** Stderr is surfaced together with partial stdout when runs fail.
- **Harness markers** (fuzzer, empirical fit, recursion visualizer): end-of-line–anchored markers; parse failures are reported instead of swallowed.
- **Webviews / timers:** Messages to disposed panels are handled safely; listener cleanup tightened.
- **Interview restore / tick:** Async flows use proper `async`/`await` with `try/catch` instead of floating `.then` chains.
- **Gamification:** Daily goal inputs validated as positive finite integers capped at 1000.

### Notes

- Deferred low-priority items are tracked in `docs/known-issues.md`.

## [0.4.1] — Iterative traversal visualizer

### Added
- **Iterative traversal visualizer** (`leetcodePractice.iterativeVisualizer.enabled`, default off). Companion to the recursion visualizer for explicit-stack / queue traversals (DFS, BFS, Dijkstra-style). Inside `traceCall()` (or `trace_call()` in Python), wrap your container with `lcexTrace.track(stack, "stack")` or `lcex_trace.track(queue, "queue")`; the harness instruments `push` / `pop` / `shift` / `unshift` (and Python `append` / `pop` / `appendleft` / `popleft` / `extend` / `insert`), assigns each pushed item the currently-expanding parent, and renders the resulting traversal tree. Repeat values surface as **revisit** edges (cycle detection / redundant work). 5,000-op cap. New command `LeetCode: Visualize Iterative Traversal`. TS / JS / Python.

## [0.4.0] — DSA practice loop: bug-review queue, fuzzer, complexity fitter, recursion visualizer

Five new opt-in features that go beyond "did your sample pass?" — all behind config flags so existing workflows are untouched.

### Added
- **Spaced-repetition bug review** (`leetcodePractice.bugReview.enabled`, default off). When an example fails, the failing input, expected/actual output, and full source are snapshotted to `~/.lcex/bug-reviews.json`. The bug resurfaces 3 / 7 / 30 / 90 days later as a re-attempt drill at `~/.lcex/reviews/bug-<id>.<ext>`. Status bar shows `$(history) N reviews due` (right-side, only when the queue is non-empty); click to open the next due. Same `(slug, input)` is idempotent — re-failing only bumps `lapseCount`. Pass-on-rerun advances the SR ladder; fail resets to 3 days. New command `LeetCode: Open Next Bug Review`.
- **Differential fuzzer vs brute-force** (`leetcodePractice.fuzzer.enabled`, default off). Define `bruteForce` and `fuzzInputs(seed)` (or `brute_force` / `fuzz_inputs` in Python) alongside your solution; the fuzzer runs both on random inputs and reports the first divergence inline as `❌ fuzz counterexample (iter N)` with args / your output / brute output in the hover. If bug-review is also on, the counterexample lands in the SR queue with `source: "fuzzer"`. New command `LeetCode: Fuzz vs Brute Force`. TS / JS / Python.
- **Empirical complexity fitter** (`leetcodePractice.empiricalFit.enabled`, default off). Define `function benchmark(n)` (or `def benchmark(n)`) that runs your solution at problem size n; the fitter times it at N ∈ {16, 64, 256, 1024, 4096, 16384}, fits 8 candidate models (`O(1)`, `O(log n)`, `O(√n)`, `O(n)`, `O(n log n)`, `O(n²)`, `O(n³)`, `O(2ⁿ)`) by least RSS on log-log, and surfaces the best fit inline with a per-N timing table on hover. When the empirical class exceeds the static estimate, the verdict turns red — catches accidental `arr.indexOf` inside loops and other hidden costs the static engine can't see. New command `LeetCode: Measure Complexity (Empirical)`. TS / JS / Python.
- **Recursion call-tree visualizer** (`leetcodePractice.recursionTree.enabled`, default off). Auto-detects the recursive function in the open file (any top-level function whose body references its own name); define `traceCall()` (or `trace_call()` in Python) that invokes it once. The visualizer instruments the function via lexical re-binding (TS / JS) or direct replacement (Python), runs the file, and renders the live call tree in a webview with collapsible nodes, return values, per-frame durations, and **memo-hit edges** (any repeat of an arg-tuple is highlighted — these are exactly the cells where memoization would pay off). 5,000-frame cap to bound infinite recursion. New command `LeetCode: Visualize Recursion Call Tree`.
- **Constraint-aware hint context.** When you trigger `Hint`, lcex now writes a JSON sidecar to `~/.lcex/hint-context/<slug>.json` containing the static complexity estimate (`bigO`, depth, confidence), the parsed problem-size budget, the budget verdict (🟢/🟡/🔴), and the top hotspot. The prompt asks the **lcex-dsa-hint** skill to load that file and tailor the nudge — no more generic spoilers when your code is already optimal, sharper bottleneck hints when it isn't.

### Changed
- **lcex-dsa-hint skill rewritten as a Socratic mentor.** Verbal-only by default (one issue + one question per turn, ~40 words), reads your current code fresh each turn, and falls back to `apply_patch` only when you explicitly ask. Replaces the prior problem-only nudge style.

### Notes
- All five features ship off-by-default behind config flags. Turn one on and exercise it for a few sessions before flipping the next; nothing here is on the on-save hot path.
- C++ is intentionally not supported in v1 for fuzzer / fitter / recursion-tree (instrumentation cost). Coming in a phase-2 if there's demand.

## [0.3.1] — Smarter complexity analysis

### Changed
- **Complexity budget engine rewritten.** Replaces the indent-only loop-counter with a structured analyzer that classifies each loop's bound (`const` / `log` / `√n` / `linear` / `amortized`), recognizes two-pointer / sliding-window / monotonic-stack as O(n) instead of O(n²), and applies Master-theorem reasoning to self-recursion (mergesort → O(n log n), DFS over adjacency → O(V+E)). Includes a curated call-cost catalog so a `sort` / `heappush` / `Array.includes` inside a loop upgrades the estimate correctly.
- **Confidence-aware severity.** When a loop's bound can't be classified statically the verdict is capped at 🟡 (`tight`) instead of escalating to 🔴, with the hover noting the fallback. Reduces false "over budget" labels on novel patterns.
- **Per-hotspot inline decorations.** Each loop / dominant call line now gets its own ghost-text annotation (`for ≈ O(n) · cumulative O(n²)`) with severity ranked against the budget's target depth, so the offending nest is visible without opening the hover.

### Defaults
- **Edge-case probes are now off by default** (`leetcodePractice.adversarialTests.enabled: false`). Run `LeetCode: Surface Adversarial Edge Cases` on demand or re-enable the setting if you want them back on save. Existing users who already set the flag explicitly are unaffected.

## [0.3.0] — Companies sidebar

### Added
- **Companies view.** New sidebar panel listing 463 companies and the ~100 LeetCode problems each one asks, with frequency, acceptance rate, difficulty (color-coded green/yellow/red dots), and topics (in the row tooltip). Click a problem to open it in the existing problem webview. Toggle the panel via `leetcodePractice.showCompanies`.
- **View-title actions:** search (filters across companies and problems by title / slug / topic), filter by difficulty, and refresh.
- **Solved / attempting overlays.** Status icons override the difficulty dot, matching the existing problem browser.
- **Topics + companies in the problem view.** Problem webview now lists relevant topics and the companies that ask the problem (with per-company frequency), populated from the same dataset.

### Credits
- Problem-frequency / acceptance / topic data is sourced from [`liquidslr/interview-company-wise-problems`](https://github.com/liquidslr/interview-company-wise-problems) (snapshot dated 1 June 2025).

## [0.2.1] — README: document the 0.2.0 inline-feedback suite

### Changed
- README and marketplace copy updated to cover lint / complexity budget / edge-case probes / on-save example results and their settings + commands. No runtime changes.

## [0.2.0] — Inline feedback suite

### Added
- **On-save inline feedback.** Saving a solution file now runs every enabled feature at once: interview lint, complexity budget, edge-case probes, and example results — all shown as ghost-text on the relevant lines, with a trusted-markdown hover for details and a one-click "turn off" link per feature.
- **Interview anti-pattern lint** (`leetcodePractice.lint.enabled`, default on): flags `mutate-input`, `builtin-sort`, `magic-number`, and indented `debug-print` across Python / TypeScript / JavaScript / C++. Emits both a `Diagnostic` (squiggle + Problems panel) and an inline hint per line. Suppressible with `// lcex-lint-ignore: <rule>` or `// lcex-lint-ignore: all`.
- **Complexity budget** (`leetcodePractice.complexityBudget.enabled`, default on): parses the problem's `Constraints:` section, derives a target complexity from the largest size cap, runs an indent-based loop-nesting estimator on your code, and paints 🟢 / 🟡 / 🔴 on the signature + each nested loop with the depth in superscript.
- **Adversarial edge-case probes** (`leetcodePractice.adversarialTests.enabled`, default on): turns parsed constraints into candidate edge cases (empty, single, max-size, boundary values, negatives, zeros, duplicate/sorted flags, charset mismatches) and surfaces them as an inline warning on the function signature. Advisory-only in this release.
- **Run examples on save** (`leetcodePractice.runExamplesOnSave.enabled`, default on): runs example lines automatically on save, with inline pass/fail per call and a dedicated timeout message for >15s runs. The on-demand command now also saves the document before running so line numbers and output stay in sync.
- **Master kill switch** (`leetcodePractice.inlineDecorations.enabled`) and `LeetCode: Clear Inline Decorations` command (`Cmd+K Cmd+L` / `Ctrl+K Ctrl+L`).
- Five toggle commands (`LeetCode: Toggle …`) for lint, complexity budget, edge-case probes, run-examples-on-save, and all inline decorations. Each is also reachable via the "turn off" link in a hover.

### Changed
- `Run Examples` now renders results inline as ghost-text next to each call line (`✓` / `✗ expected X · got Y`) instead of as a popup notification. Status bar shows the summary. Runtime errors and timeouts surface inline with a hover-for-details message.
- Editing a solution file now auto-clears stale inline decorations and `lcex-lint` diagnostics until the next save.
- Problem fetches for the new features share a 5-minute in-memory cache keyed by slug, so save-heavy workflows don't re-hit the LeetCode API.

## [0.1.9] — Analytics works without sign-in

### Changed
- Anonymous analytics no longer requires cloud sign-in. On first send, the extension mints a per-install anonymous Firebase identity (separate from any Google sign-in used for stats sync) and uses it to write events. Privacy posture is unchanged — only an opaque per-install UUID identifies the sender, all values remain enum-validated, and `vscode.env.isTelemetryEnabled` + the `leetcodePractice.analytics.enabled` setting still gate everything.

## [0.1.8] — Marketplace discoverability

### Changed
- Refined marketplace metadata for better search ranking and category listings on VS Code Marketplace and Open VSX:
  - `displayName` expanded to "LeetCode Practice — Problems, Study Plans & Interview Mode".
  - `description` reworked to front-load high-intent terms (Top Interview 150, Blind 75, mock interview).
  - `categories` realigned with top-ranked peers: `Education`, `Snippets`, `Programming Languages`, `Other` (added `Snippets`, which is the category the highest-install peer publishes under).
  - `keywords` expanded to cover long-tail queries (DSA, coding interview, mock interview, Blind 75, QOTD, etc.).

## [0.1.7] — Open VSX publish fix

### Changed
- Base64-encode the public Firebase Web API key in source so Open VSX's static secret scanner no longer blocks publish. No behavioural change; the key is still a public client identifier decoded at runtime.

## [0.1.6] — Anonymous analytics

### Added
- Opt-outable anonymous usage analytics written to a separate Firestore `/logs` collection under a pseudonymous per-install UUID. Only allow-listed enums and bucketed dimensions (difficulty, language, duration, count) are sent; no slugs, notes, code, file paths, or exact timestamps. Requires cloud sign-in; respects `vscode.env.isTelemetryEnabled`. Toggle with `LeetCode: Toggle anonymous analytics` or `leetcodePractice.analytics.enabled`.
- Admin analytics dashboard at `https://lc-ext.web.app/admin` with charts and filters (admin-only).

### Changed
- Tightened Firestore rules for `/logs`: strict shape + enum validation, no update/delete, reads restricted to admin uid.
- Excluded `screenshots/` from the `.vsix` (README renders them from GitHub raw URLs) — shaves ~3.7 MB off the package.

## [0.1.5] — README refresh

### Changed
- Professional README layout with non-duplicated badges, hero screenshot, and a two-column captioned screenshot grid covering all views.

## [0.1.4] — CI pipeline smoke-test

### Changed
- Internal release-pipeline iteration; no user-facing changes.

## [0.1.3] — Release automation and docs polish

### Added
- GitHub Actions workflow to package the extension and publish to Open VSX on tagged releases, with the VSIX attached to the GitHub Release.

### Changed
- Rewrote the README with a professional layout, marketplace badges, curated screenshots, and category-grouped command/setting tables.

## [0.1.2] — Screenshot refresh

### Changed
- Refreshed README screenshot assets for the latest extension UI views.

## [0.1.1] — Cleanup, packaging, and docs polish

### Changed
- Cleaned repository structure by moving workspace practice/interview artifacts into `examples/workspace-artifacts/`.
- Updated and simplified README to standard VS Code extension format with feature-focused sections.
- Added/renamed screenshot assets with view-based filenames and linked them directly in README.
- Tightened `.gitignore` and `.vscodeignore` to exclude local/deploy-only/generated files from source control and VSIX packaging.
- Updated extension assets and packaging config for the live release flow.

## [0.1.0] — Initial Marketplace release

### Added
- Workspace-scoped activation via `.leetcode` marker file.
- Sidebar views: full problemset, study plans, problem lists, Question of the Day.
- Solution file generation in TypeScript, JavaScript, Python, and C++ via EJS templates.
- Inline example runner with `// Expected:` comparison and "Run in Terminal" command.
- Problem webview with statement, examples, and "Create File" actions.
- Custom editors for `.leetcode`, `.lcInterview`, `.lcireport`, and `.hint` files.
- LeetCode session sign-in for problem and study-plan data.
- Local progress tracking: solved / attempting / cleared status, streaks, XP, levels.
- Daily goals (problems and minutes) with status-bar progress.
- Timed Interview Mode with focus layout, per-problem timing, and report generation.
- Stats webview with activity, streak, XP, and interview history.
- Cloud stats sync via Firebase (Google sign-in; uid-scoped writes).
- URI handler `vscode://nikkyamresh.leetcode-practice/open/{slug}` for one-click open.
- Question of the Day, focus mode, and configurable file naming (`id` / `slug`).
