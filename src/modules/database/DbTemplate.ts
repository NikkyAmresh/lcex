/**
 * Solution file templates for database problems.
 *
 * Both modes get the schema and the seeded example rows written into the file as
 * comments, so the tables you are querying are visible next to the query itself
 * rather than only in the problem webview.
 */
import type { Problem } from "../interface/Problem";
import type { DatabaseLanguage } from "../interface/Problem";
import { parseDbSchema, parseDbSeed, parseExpectedGrid, renderGrid } from "./DbProblem";
import type { DbSeedTable, DbTableSchema } from "./DbProblem";

function commentBlock(lines: string[], prefix: string): string {
  return lines.map((l) => (l.trim() ? `${prefix} ${l}` : prefix)).join("\n");
}

/** Indents content lines but leaves blank separators blank, so no line ends in whitespace. */
function indent(lines: string[]): string[] {
  return lines.map((l) => (l.trim() ? `  ${l}` : ""));
}

function schemaLines(tables: readonly DbTableSchema[]): string[] {
  const out: string[] = [];
  for (const t of tables) {
    out.push(`${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`);
  }
  return out;
}

function seedLines(seed: readonly DbSeedTable[]): string[] {
  const out: string[] = [];
  for (const t of seed) {
    out.push(`${t.name}:`);
    out.push(...renderGrid({ columns: t.columns, rows: t.rows }).split("\n"));
    out.push("");
  }
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/** Schema, seeded example input, and expected output, as comment lines. */
function contextLines(problem: Problem): string[] {
  const schema = parseDbSchema(problem);
  const seed = parseDbSeed(problem);
  const expected = parseExpectedGrid(problem.content);
  const lines: string[] = [];
  if (schema) {
    lines.push("Tables");
    lines.push(...indent(schemaLines(schema.tables)));
  }
  if (seed) {
    lines.push("");
    lines.push("Example input (this is what a local run seeds)");
    lines.push(...indent(seedLines(seed)));
  }
  if (expected) {
    lines.push("");
    lines.push("Expected output");
    lines.push(...indent(renderGrid(expected).split("\n")));
  }
  return lines;
}

function headerLines(problem: Problem): string[] {
  return [
    `${problem.id}. ${problem.title}`,
    problem.difficulty ? `Difficulty: ${problem.difficulty}` : "",
    `https://leetcode.com/problems/${problem.titleSlug}/`,
  ].filter((l) => l !== "");
}

function mysqlTemplate(problem: Problem): string {
  const header = commentBlock([...headerLines(problem), "", ...contextLines(problem)], "--");
  const snippet = problem.codeSnippets?.mysql?.trim() || "# Write your MySQL query statement below";
  return `${header}\n\n${snippet}\n\n`;
}

function pandasTemplate(problem: Problem): string {
  const header = commentBlock([...headerLines(problem), "", ...contextLines(problem)], "#");
  const snippet =
    problem.codeSnippets?.pythondata?.trim() ||
    `import pandas as pd\n\ndef ${parseDbSchema(problem)?.functionName ?? "solve"}() -> pd.DataFrame:`;
  const needsBody = /:\s*$/.test(snippet);
  return `${header}\n\n${snippet}${needsBody ? "\n    # TODO\n" : "\n"}\n`;
}

/** Solution file contents for a database problem in the given mode. */
export function generateDbTemplate(problem: Problem, language: DatabaseLanguage): string {
  return language === "mysql" ? mysqlTemplate(problem) : pandasTemplate(problem);
}
