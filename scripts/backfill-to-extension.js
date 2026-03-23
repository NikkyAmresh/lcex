#!/usr/bin/env node
/**
 * Backfill solvedAt dates into the extension's globalStorage SQLite DB.
 *
 * Reads backfill-solved-dates.json and merges into the existing
 * leetcode-practice.problemStatus in state.vscdb.
 *
 * Usage:
 *   node --experimental-sqlite scripts/backfill-to-extension.js [--dry-run]
 *
 * IMPORTANT: Close Cursor before running (without --dry-run) to avoid DB lock conflicts.
 */

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SKIP_SLUGS = new Set(["pnc", "telegram", "test"]);
const DB_KEY = "lcex.leetcode-practice";
const STATUS_FIELD = "leetcode-practice.problemStatus";

const backfillPath = process.argv[2] && !process.argv[2].startsWith("--")
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "backfill-solved-dates.json");

const dbPath = path.join(
  process.env.HOME || "~",
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb"
);

const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(backfillPath)) {
  console.error(`Backfill file not found: ${backfillPath}`);
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`DB not found: ${dbPath}`);
  process.exit(1);
}

const backfill = JSON.parse(fs.readFileSync(backfillPath, "utf8"));
const db = new DatabaseSync(dbPath, { open: true });

const row = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get(DB_KEY);
if (!row) {
  console.error(`No row found for key '${DB_KEY}' in DB`);
  db.close();
  process.exit(1);
}

const blob = JSON.parse(row.value);
const problemStatus = blob[STATUS_FIELD] ?? {};

let added = 0;
let updated = 0;
let skipped = 0;
let kept = 0;
const changes = [];

for (const [slug, date] of Object.entries(backfill)) {
  if (SKIP_SLUGS.has(slug)) {
    skipped++;
    changes.push(`  SKIP  ${slug} (non-leetcode)`);
    continue;
  }

  const existing = problemStatus[slug];

  if (existing === undefined) {
    problemStatus[slug] = { status: "solved", solvedAt: date };
    added++;
    changes.push(`  ADD   ${slug} -> solved @ ${date}`);
  } else if (typeof existing === "string") {
    if (existing === "solved") {
      problemStatus[slug] = { status: "solved", solvedAt: date };
      updated++;
      changes.push(`  UPDT  ${slug}: "solved" -> { solved, solvedAt: ${date} }`);
    } else {
      kept++;
      changes.push(`  KEEP  ${slug} (status: ${existing}, not overwriting)`);
    }
  } else if (typeof existing === "object") {
    if (existing.status === "solved" && !existing.solvedAt) {
      existing.solvedAt = date;
      updated++;
      changes.push(`  UPDT  ${slug}: added solvedAt ${date}`);
    } else if (existing.status === "solved" && existing.solvedAt) {
      kept++;
      changes.push(`  KEEP  ${slug} (already has solvedAt: ${existing.solvedAt})`);
    } else {
      kept++;
      changes.push(`  KEEP  ${slug} (status: ${existing.status}, not overwriting)`);
    }
  }
}

blob[STATUS_FIELD] = problemStatus;

const totalEntries = Object.keys(problemStatus).length;

console.log(`\n=== Backfill Summary ===`);
console.log(`Backfill file: ${backfillPath}`);
console.log(`DB: ${dbPath}`);
console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
console.log(`\nBackfill entries: ${Object.keys(backfill).length}`);
console.log(`DB entries before: ${row ? Object.keys(JSON.parse(row.value)[STATUS_FIELD] ?? {}).length : 0}`);
console.log(`DB entries after:  ${totalEntries}`);
console.log(`\n  Added:   ${added}`);
console.log(`  Updated: ${updated}`);
console.log(`  Kept:    ${kept}`);
console.log(`  Skipped: ${skipped}`);
console.log(`\n--- Changes ---`);
for (const c of changes) console.log(c);

if (!dryRun) {
  const newValue = JSON.stringify(blob);
  db.prepare(`UPDATE ItemTable SET value = ? WHERE key = ?`).run(newValue, DB_KEY);
  console.log(`\nDB updated successfully.`);
} else {
  console.log(`\nDry run complete. No changes written.`);
}

db.close();
