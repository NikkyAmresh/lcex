#!/usr/bin/env node
/**
 * Build data/companies.json from the upstream interview-company-wise-problems
 * SQLite snapshot.
 *
 * Source: https://github.com/liquidslr/interview-company-wise-problems
 * Run when the upstream repo is refreshed:
 *   npm run build:companies-data            # uses default path below
 *   npm run build:companies-data -- --db /path/to/sqlite.db
 *
 * Output schema (deduplicated to keep the file small):
 *   {
 *     version: 1,
 *     generatedAt: "YYYY-MM-DD",
 *     problems: [{ slug, title, difficulty, accept, topics: [...] }],
 *     companies: { [name]: [{ i, freq }] }   // i = index into problems[]
 *   }
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const DEFAULT_DB = "/Users/nikky.amresh/files/interview-company-wise-problems/sqlite.db";
const OUT_PATH = join(REPO_ROOT, "data/companies.json");

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" && args[i + 1]) {
      dbPath = args[i + 1];
      i++;
    }
  }
  return { dbPath };
}

function slugFromLink(link) {
  if (typeof link !== "string") return "";
  const m = link.match(/\/problems\/([^/?#]+)/);
  return m ? m[1] : "";
}

function parseTopics(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function round4(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function main() {
  const { dbPath } = parseArgs();
  if (!existsSync(dbPath)) {
    console.error(`SQLite DB not found at ${dbPath}`);
    console.error("Pass --db <path> to override the default location.");
    process.exit(1);
  }

  const sql =
    "SELECT company, difficulty, title, frequency, acceptance_rate, link, topics FROM problems";
  const tsv = execFileSync("sqlite3", ["-separator", "\t", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const problemsBySlug = new Map();
  const companyEdges = new Map();
  let edgeCount = 0;

  for (const line of tsv.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [company, difficulty, title, freqStr, acceptStr, link, topicsRaw] = parts;
    const slug = slugFromLink(link);
    if (!slug) continue;
    if (!problemsBySlug.has(slug)) {
      problemsBySlug.set(slug, {
        slug,
        title,
        difficulty: (difficulty || "").toUpperCase(),
        accept: round4(Number(acceptStr)),
        topics: parseTopics(topicsRaw),
      });
    }
    const freq = round4(Number(freqStr));
    const arr = companyEdges.get(company) ?? [];
    arr.push({ slug, freq });
    companyEdges.set(company, arr);
    edgeCount++;
  }

  // Stable index assignment: alphabetical by slug for reproducibility.
  const problemsArr = [...problemsBySlug.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );
  const slugToIndex = new Map(problemsArr.map((p, i) => [p.slug, i]));

  const companyKeys = [...companyEdges.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const companies = {};
  for (const name of companyKeys) {
    const edges = companyEdges.get(name) ?? [];
    edges.sort((a, b) => b.freq - a.freq || a.slug.localeCompare(b.slug));
    companies[name] = edges.map((e) => ({ i: slugToIndex.get(e.slug), freq: e.freq }));
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    problems: problemsArr,
    companies,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out));
  const bytes = Buffer.byteLength(JSON.stringify(out));
  console.log(
    `Wrote ${OUT_PATH}: ${problemsArr.length} problems, ${companyKeys.length} companies, ${edgeCount} edges, ${(bytes / 1024).toFixed(1)} KB`
  );
}

main();
