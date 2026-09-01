import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_MIN_AGE_MS,
  FEEDBACK_PROMPT_INTERVAL_MS,
  FEEDBACK_STATE_KEY,
  clearPendingFeedback,
  ensureFeedbackState,
  markOptedOut,
  markPrompted,
  markSubmitted,
  readFeedbackState,
  resetFeedbackState,
  shouldPromptFeedback,
  type FeedbackDoc,
  type FeedbackState,
  type PromptGateInput,
} from "../src/modules/feedback/FeedbackState.js";
import {
  composeFeedbackCopy,
  computeFeedbackStats,
  formatMinutes,
  friendlyName,
  lastNDays,
  type FeedbackStats,
  type FeedbackStatsInput,
} from "../src/modules/feedback/FeedbackStats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 1, 12);
const TODAY = "2026-09-01";

type Memento = Parameters<typeof readFeedbackState>[0];

function fakeMemento(seed: Record<string, unknown> = {}): Memento & { dump: () => Record<string, unknown> } {
  const m = new Map<string, unknown>(Object.entries(seed));
  return {
    keys: () => [...m.keys()],
    get: (<T>(key: string, def?: T) => (m.has(key) ? (m.get(key) as T) : def)) as Memento["get"],
    update: async (key: string, value: unknown) => {
      if (value === undefined) m.delete(key);
      else m.set(key, value);
    },
    dump: () => Object.fromEntries(m),
  };
}

function state(over: Partial<FeedbackState> = {}): FeedbackState {
  return { v: 1, firstSeenAt: NOW - 10 * DAY, promptCount: 0, status: "pending", ...over };
}

function gate(over: Partial<PromptGateInput> = {}): PromptGateInput {
  return {
    now: NOW,
    state: state(),
    settingEnabled: true,
    interviewActive: false,
    focusModeActive: false,
    panelOpen: false,
    totalSolved: 5,
    totalPracticeSeconds: 0,
    ...over,
  };
}

function doc(over: Partial<FeedbackDoc> = {}): FeedbackDoc {
  return {
    docId: "abc",
    schemaVersion: 1,
    ts: NOW,
    installId: "00000000-0000-4000-8000-000000000000",
    rating: 4,
    comment: "",
    allowContact: false,
    extVersion: "0.12.1",
    vscodeVersion: "1.90.0",
    platform: "darwin",
    locale: "en",
    source: "prompt",
    promptCount: 1,
    weekSolves: 0,
    weekMinutes: 0,
    level: 1,
    totalSolved: 0,
    streak: 0,
    ...over,
  };
}

function input(over: Partial<FeedbackStatsInput> = {}): FeedbackStatsInput {
  return {
    today: TODAY,
    statusEntries: {},
    timerByDay: {},
    practiceSecondsTotal: undefined,
    totalXp: 0,
    interviewEndedAts: [],
    nowMs: NOW,
    leetcodeUsername: "",
    cloudEmail: null,
    ...over,
  };
}

function solved(day: string) {
  return { status: "solved" as const, solvedAt: day };
}

// ---------------------------------------------------------------------------
// FeedbackState
// ---------------------------------------------------------------------------

test("readFeedbackState repairs missing and corrupt values without writing", () => {
  const empty = fakeMemento();
  assert.deepEqual(readFeedbackState(empty, NOW), { v: 1, firstSeenAt: NOW, promptCount: 0, status: "pending" });
  assert.deepEqual(empty.dump(), {});

  const corrupt = fakeMemento({ [FEEDBACK_STATE_KEY]: "nonsense" });
  assert.equal(readFeedbackState(corrupt, NOW).status, "pending");

  const unknownStatus = fakeMemento({ [FEEDBACK_STATE_KEY]: { v: 1, firstSeenAt: 5, promptCount: -3, status: "weird" } });
  const s = readFeedbackState(unknownStatus, NOW);
  assert.equal(s.status, "pending");
  assert.equal(s.promptCount, 0);
  assert.equal(s.firstSeenAt, 5);
});

test("ensureFeedbackState writes once and seeds firstSeenAt from earlier activity", async () => {
  const m = fakeMemento();
  const seeded = await ensureFeedbackState(m, NOW, NOW - 30 * DAY);
  assert.equal(seeded.firstSeenAt, NOW - 30 * DAY);
  const again = await ensureFeedbackState(m, NOW + DAY, NOW - 100 * DAY);
  assert.equal(again.firstSeenAt, NOW - 30 * DAY, "existing state is kept");

  const future = fakeMemento();
  assert.equal((await ensureFeedbackState(future, NOW, NOW + DAY)).firstSeenAt, NOW, "seed is capped at now");
  const noSeed = fakeMemento();
  assert.equal((await ensureFeedbackState(noSeed, NOW)).firstSeenAt, NOW);
});

test("shouldPromptFeedback: setting and terminal statuses come first", () => {
  assert.deepEqual(shouldPromptFeedback(gate({ settingEnabled: false })), { prompt: false, reason: "disabled" });
  assert.deepEqual(shouldPromptFeedback(gate({ state: state({ status: "submitted" }) })), { prompt: false, reason: "submitted" });
  assert.deepEqual(shouldPromptFeedback(gate({ state: state({ status: "opted_out" }) })), { prompt: false, reason: "opted_out" });
});

test("shouldPromptFeedback: interview, focus mode and an open panel defer without snoozing", () => {
  assert.deepEqual(shouldPromptFeedback(gate({ interviewActive: true })), { prompt: false, reason: "interview" });
  assert.deepEqual(shouldPromptFeedback(gate({ focusModeActive: true })), { prompt: false, reason: "focus" });
  assert.deepEqual(shouldPromptFeedback(gate({ panelOpen: true })), { prompt: false, reason: "panel_open" });
});

test("shouldPromptFeedback: too_new boundary is exactly three days", () => {
  assert.deepEqual(
    shouldPromptFeedback(gate({ state: state({ firstSeenAt: NOW - FEEDBACK_MIN_AGE_MS + 1 }) })),
    { prompt: false, reason: "too_new" }
  );
  assert.deepEqual(shouldPromptFeedback(gate({ state: state({ firstSeenAt: NOW - FEEDBACK_MIN_AGE_MS }) })), { prompt: true });
});

test("shouldPromptFeedback: engagement needs one solve or twenty minutes", () => {
  assert.deepEqual(shouldPromptFeedback(gate({ totalSolved: 0, totalPracticeSeconds: 1199 })), { prompt: false, reason: "not_engaged" });
  assert.deepEqual(shouldPromptFeedback(gate({ totalSolved: 1, totalPracticeSeconds: 0 })), { prompt: true });
  assert.deepEqual(shouldPromptFeedback(gate({ totalSolved: 0, totalPracticeSeconds: 1200 })), { prompt: true });
});

test("shouldPromptFeedback: snooze boundary is exactly seven days", () => {
  assert.deepEqual(
    shouldPromptFeedback(gate({ state: state({ lastPromptedAt: NOW - FEEDBACK_PROMPT_INTERVAL_MS + 1 }) })),
    { prompt: false, reason: "snoozed" }
  );
  assert.deepEqual(shouldPromptFeedback(gate({ state: state({ lastPromptedAt: NOW - FEEDBACK_PROMPT_INTERVAL_MS }) })), { prompt: true });
  assert.deepEqual(shouldPromptFeedback(gate({ state: state({ lastPromptedAt: undefined }) })), { prompt: true });
});

test("state transitions", async () => {
  const m = fakeMemento();
  await ensureFeedbackState(m, NOW - 10 * DAY);

  const prompted = await markPrompted(m, NOW);
  assert.equal(prompted.lastPromptedAt, NOW);
  assert.equal(prompted.promptCount, 1);
  assert.equal((await markPrompted(m, NOW + 1)).promptCount, 2);

  const out = await markOptedOut(m, NOW);
  assert.equal(out.status, "opted_out");
  assert.equal(out.optedOutAt, NOW);

  const sub = await markSubmitted(m, NOW + 5, doc());
  assert.equal(sub.status, "submitted");
  assert.equal(sub.submittedAt, NOW + 5);
  assert.equal(sub.pending?.docId, "abc");
  assert.equal(readFeedbackState(m, NOW).pending?.docId, "abc", "pending survives a round trip");

  const cleared = await clearPendingFeedback(m, NOW);
  assert.equal(cleared.pending, undefined);
  assert.equal(cleared.status, "submitted");
  assert.equal(cleared.promptCount, 2);

  await resetFeedbackState(m);
  assert.deepEqual(m.dump(), {});
});

// ---------------------------------------------------------------------------
// FeedbackStats
// ---------------------------------------------------------------------------

test("lastNDays crosses a month boundary, oldest first", () => {
  assert.deepEqual(lastNDays(TODAY, 7), [
    "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01",
  ]);
});

test("week solves vs lifetime solves", () => {
  const s = computeFeedbackStats(
    input({
      statusEntries: {
        a: solved(TODAY),
        b: solved("2026-08-26"),
        c: solved("2026-08-25"),
        d: { status: "attempting" },
        e: { status: "solved" },
      },
    })
  );
  assert.equal(s.weekSolves, 2);
  assert.equal(s.totalSolved, 4, "legacy solved entries without a date still count toward lifetime");
  assert.equal(s.earliestActivityMs, Date.UTC(2026, 7, 25));
});

test("week minutes are summed inside the window only, ignoring junk", () => {
  const s = computeFeedbackStats(
    input({
      timerByDay: {
        [TODAY]: { x: 100 * 60, y: 20 * 60 },
        "2026-08-26": { x: 72 * 60 + 20 },
        "2026-08-20": { x: 500 * 60 },
        "2026-08-21": { x: Number.NaN, y: Infinity },
      },
    })
  );
  assert.equal(s.weekMinutes, 192);
  assert.equal(s.hasWeekActivity, true);
  assert.equal(s.totalPracticeSeconds, (100 + 20 + 72 + 500) * 60 + 20);
  assert.equal(s.earliestActivityMs, Date.UTC(2026, 7, 20));
});

test("totalPracticeSeconds takes the larger of the stored counter and the timer sum", () => {
  assert.equal(computeFeedbackStats(input({ practiceSecondsTotal: 5000, timerByDay: { [TODAY]: { a: 60 } } })).totalPracticeSeconds, 5000);
  assert.equal(computeFeedbackStats(input({ practiceSecondsTotal: 10, timerByDay: { [TODAY]: { a: 60 } } })).totalPracticeSeconds, 60);
  assert.equal(computeFeedbackStats(input({ practiceSecondsTotal: undefined })).totalPracticeSeconds, 0);
});

test("level, streak and interviews", () => {
  assert.equal(computeFeedbackStats(input({ totalXp: 350 })).level, 3);
  assert.equal(computeFeedbackStats(input({ totalXp: 1000 })).level, 5);

  const three = { a: solved(TODAY), b: solved("2026-08-31"), c: solved("2026-08-30") };
  assert.equal(computeFeedbackStats(input({ statusEntries: three })).streak, 3);
  const gap = { a: solved(TODAY), b: solved("2026-08-30") };
  assert.equal(computeFeedbackStats(input({ statusEntries: gap })).streak, 1);
  const stale = { a: solved("2026-08-29") };
  assert.equal(computeFeedbackStats(input({ statusEntries: stale })).streak, 0);

  const s = computeFeedbackStats(input({ interviewEndedAts: [NOW - DAY, NOW - 8 * DAY, NOW + DAY] }));
  assert.equal(s.weekInterviews, 1);
});

test("friendlyName prefers the email, then the LeetCode handle, and never returns junk", () => {
  assert.equal(friendlyName("nikkyamresh", "nikky.amresh@ei.study"), "Nikky");
  assert.equal(friendlyName("nikkyamresh", null), "Nikkyamresh");
  assert.equal(friendlyName("user123", null), "User");
  assert.equal(friendlyName("", null), undefined);
  assert.equal(friendlyName("x", null), undefined);
  assert.equal(friendlyName("", "x1@y.z"), undefined);
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(192), "3h 12m");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(0), "");
});

test("copy: the full weekly sentence is exact", () => {
  const entries: Record<string, { status: "solved"; solvedAt: string }> = {};
  for (let i = 0; i < 7; i++) entries[`p${i}`] = solved(i % 2 ? TODAY : "2026-08-30");
  const s = computeFeedbackStats(
    input({ statusEntries: entries, timerByDay: { [TODAY]: { a: 192 * 60 } }, cloudEmail: "nikky.amresh@ei.study" })
  );
  const c = composeFeedbackCopy(s);
  assert.equal(c.notification, "Nikky, 7 solves and 3h 12m of practice with lcex this week. Got 30 seconds to tell us how it's going?");
  assert.equal(c.summary, "Nikky, 7 solves and 3h 12m of practice in the last 7 days.");
  assert.equal(c.headline, "How is lcex going for you?");
  assert.deepEqual(c.tiles.map((t) => t.label), ["Solved this week", "Practice this week", "Level", "Streak"]);
});

test("copy: partial weekly variants", () => {
  const base: FeedbackStats = {
    displayName: "Nikky", weekSolves: 0, weekMinutes: 0, weekInterviews: 0, hasWeekActivity: true,
    level: 2, totalSolved: 10, streak: 1, totalPracticeSeconds: 0,
  };
  assert.equal(
    composeFeedbackCopy({ ...base, weekSolves: 1 }).notification,
    "Nikky, 1 solve with lcex this week. Got 30 seconds to tell us how it's going?"
  );
  assert.equal(
    composeFeedbackCopy({ ...base, weekMinutes: 45 }).notification,
    "Nikky, 45m of practice with lcex this week. Got 30 seconds to tell us how it's going?"
  );
  assert.equal(
    composeFeedbackCopy({ ...base, displayName: undefined, weekSolves: 3, weekMinutes: 60 }).notification,
    "3 solves and 1h of practice with lcex this week. Got 30 seconds to tell us how it's going?"
  );
});

test("copy: lifetime fallback and the last resort", () => {
  const quiet: FeedbackStats = {
    displayName: "Nikky", weekSolves: 0, weekMinutes: 0, weekInterviews: 0, hasWeekActivity: false,
    level: 5, totalSolved: 42, streak: 6, totalPracticeSeconds: 0,
  };
  const named = composeFeedbackCopy(quiet).notification;
  assert.match(named, /^Nikky, you are level 5 with 42 problems solved and a 6-day streak in lcex\./);
  const noStreak = composeFeedbackCopy({ ...quiet, streak: 0 }).notification;
  assert.equal(noStreak.includes("streak"), false);
  const anon = composeFeedbackCopy({ ...quiet, displayName: undefined, streak: 0 }).notification;
  assert.match(anon, /^Level 5, 42 problems solved in lcex so far\./);
  assert.match(composeFeedbackCopy({ ...quiet, totalSolved: 1, streak: 0 }).notification, /1 problem solved/);

  const practiceOnly = composeFeedbackCopy({ ...quiet, displayName: undefined, level: 1, totalSolved: 0, streak: 0, totalPracticeSeconds: 25 * 60 });
  assert.equal(practiceOnly.notification, "25m of practice with lcex so far. Got 30 seconds to tell us how it's going?");

  const nothing = composeFeedbackCopy({ ...quiet, displayName: undefined, level: 1, totalSolved: 0, streak: 0 });
  assert.equal(nothing.notification, "How is lcex going for you?");
  assert.deepEqual(nothing.tiles, []);
});

test("copy hygiene: no em-dash, no double hyphen, no emoji in any variant", () => {
  const variants: FeedbackStats[] = [];
  for (const displayName of ["Nikky", undefined]) {
    for (const weekSolves of [0, 1, 7]) {
      for (const weekMinutes of [0, 45, 192]) {
        for (const streak of [0, 1, 6]) {
          variants.push({
            displayName, weekSolves, weekMinutes, weekInterviews: 0,
            hasWeekActivity: weekSolves > 0 || weekMinutes > 0,
            level: 3, totalSolved: 12, streak, totalPracticeSeconds: 900,
          });
        }
      }
    }
  }
  for (const v of variants) {
    const c = composeFeedbackCopy(v);
    const strings = [c.notification, c.headline, c.summary, ...c.tiles.flatMap((t) => [t.label, t.value])];
    for (const s of strings) {
      assert.equal(s.includes("\u2014"), false, s);
      assert.equal(s.includes("-".repeat(2)), false, s);
      for (const ch of s) assert.ok((ch.codePointAt(0) ?? 0) < 0x2600, `${s} contains ${ch}`);
    }
  }
});
