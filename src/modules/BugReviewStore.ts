import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import { LCEX_HOME_DIR, atomicWriteJsonSync, ensureLcexDir } from "./LcexInterviewReportStore";

export const BUG_REVIEWS_FILE = path.join(LCEX_HOME_DIR, "bug-reviews.json");

export type BugReviewSource = "examples" | "fuzzer";
export type BugReviewInterval = 3 | 7 | 30 | 90;

export interface BugReview {
  id: string;
  titleSlug: string;
  problemTitle?: string;
  language: SupportedLanguage;
  source: BugReviewSource;
  failedAt: string;
  lastReviewedAt?: string;
  nextDueAt: string;
  lapseCount: number;
  intervalDays: BugReviewInterval;
  input: string;
  expected: string;
  actual: string;
  sourceSnippet: string;
  /** Full solution source at failure time. Re-runs use this so the bug reproduces deterministically. */
  fullSource: string;
}

export interface BugReviewStoreV1 {
  version: 1;
  reviews: BugReview[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_LADDER: BugReviewInterval[] = [3, 7, 30, 90];

function emptyStore(): BugReviewStoreV1 {
  return { version: 1, reviews: [] };
}

export function readBugReviews(): BugReviewStoreV1 {
  try {
    if (!fs.existsSync(BUG_REVIEWS_FILE)) return emptyStore();
    const raw = fs.readFileSync(BUG_REVIEWS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BugReviewStoreV1>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.reviews)) return emptyStore();
    return { version: 1, reviews: parsed.reviews as BugReview[] };
  } catch {
    return emptyStore();
  }
}

export function writeBugReviews(store: BugReviewStoreV1): void {
  ensureLcexDir();
  atomicWriteJsonSync(BUG_REVIEWS_FILE, store);
}

function bugId(titleSlug: string, input: string): string {
  const h = crypto.createHash("sha1").update(`${titleSlug}::${input}`, "utf8").digest("hex");
  return `${titleSlug}-${h.slice(0, 12)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * ONE_DAY_MS).toISOString();
}

export interface RecordFailureInput {
  titleSlug: string;
  problemTitle?: string;
  language: SupportedLanguage;
  source: BugReviewSource;
  input: string;
  expected: string;
  actual: string;
  sourceSnippet: string;
  fullSource: string;
}

/** Insert or refresh a bug-review entry. If already present, only update timestamps + actual. */
export function recordFailure(input: RecordFailureInput): BugReview {
  const store = readBugReviews();
  const id = bugId(input.titleSlug, input.input);
  const now = isoNow();
  const existing = store.reviews.find((r) => r.id === id);
  if (existing) {
    existing.failedAt = now;
    existing.actual = input.actual;
    existing.expected = input.expected;
    existing.sourceSnippet = input.sourceSnippet;
    existing.fullSource = input.fullSource;
    existing.problemTitle = input.problemTitle ?? existing.problemTitle;
    // Reset due date so the user sees it surface again
    existing.lapseCount += 1;
    existing.intervalDays = 3;
    existing.nextDueAt = addDays(now, 3);
    writeBugReviews(store);
    return existing;
  }
  const review: BugReview = {
    id,
    titleSlug: input.titleSlug,
    problemTitle: input.problemTitle,
    language: input.language,
    source: input.source,
    failedAt: now,
    nextDueAt: addDays(now, 3),
    lapseCount: 0,
    intervalDays: 3,
    input: input.input,
    expected: input.expected,
    actual: input.actual,
    sourceSnippet: input.sourceSnippet,
    fullSource: input.fullSource,
  };
  store.reviews.push(review);
  writeBugReviews(store);
  return review;
}

export function listDueReviews(now: Date = new Date()): BugReview[] {
  const store = readBugReviews();
  const t = now.getTime();
  return store.reviews
    .filter((r) => new Date(r.nextDueAt).getTime() <= t)
    .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime());
}

export function countDueReviews(now: Date = new Date()): number {
  return listDueReviews(now).length;
}

export function getReviewById(id: string): BugReview | undefined {
  return readBugReviews().reviews.find((r) => r.id === id);
}

/** On a successful re-run: advance to the next interval in the ladder. */
export function advanceOnPass(id: string): BugReview | undefined {
  const store = readBugReviews();
  const r = store.reviews.find((x) => x.id === id);
  if (!r) return undefined;
  const idx = INTERVAL_LADDER.indexOf(r.intervalDays);
  const nextIdx = Math.min(idx + 1, INTERVAL_LADDER.length - 1);
  const nextInterval = INTERVAL_LADDER[nextIdx];
  const now = isoNow();
  r.lastReviewedAt = now;
  r.intervalDays = nextInterval;
  r.nextDueAt = addDays(now, nextInterval);
  writeBugReviews(store);
  return r;
}

/** On a failed re-run: keep at base interval, bump lapse count, push out 3 days. */
export function lapseOnFail(id: string): BugReview | undefined {
  const store = readBugReviews();
  const r = store.reviews.find((x) => x.id === id);
  if (!r) return undefined;
  const now = isoNow();
  r.lastReviewedAt = now;
  r.lapseCount += 1;
  r.intervalDays = 3;
  r.nextDueAt = addDays(now, 3);
  writeBugReviews(store);
  return r;
}

export function deleteReview(id: string): boolean {
  const store = readBugReviews();
  const before = store.reviews.length;
  store.reviews = store.reviews.filter((r) => r.id !== id);
  if (store.reviews.length === before) return false;
  writeBugReviews(store);
  return true;
}
