#!/usr/bin/env node
/**
 * Temporary script: retrieve last-modified dates of solution files in ~/files/lc/*.ts
 * and output as JSON for backfilling solvedAt stats.
 *
 * Usage: node scripts/retrieve-solved-dates.js [dir]
 *   dir: path to folder containing .ts files (default: ~/files/lc)
 *
 * Output: JSON object { "filename-without-ext": "YYYY-MM-DD", ... }
 * Use this to update leetcode-practice.problemStatus entries with solvedAt.
 */

const fs = require("fs");
const path = require("path");

const defaultDir = path.join(process.env.HOME || "~", "files", "lc");
const dir = process.argv[2] ? path.resolve(process.argv[2]) : defaultDir;

if (!fs.existsSync(dir)) {
  console.error(`Directory not found: ${dir}`);
  process.exit(1);
}

const result = {};
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

for (const file of files) {
  const filePath = path.join(dir, file);
  const stat = fs.statSync(filePath);
  const basename = file.replace(/\.ts$/, "");
  const date = stat.mtime.toISOString().slice(0, 10);
  result[basename] = date;
}

console.log(JSON.stringify(result, null, 2));
