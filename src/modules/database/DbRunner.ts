/**
 * One entry point for running a database solution locally, in either mode.
 *
 * The two modes diverge completely below this layer (a SQLite/WASM query versus a
 * Python subprocess driving DataFrames), but they agree on everything around it:
 * the same seeded example dataset goes in, and the same grid comparison against
 * the problem statement's expected output comes out.
 */
import type { Problem } from "../interface/Problem";
import type { DatabaseLanguage } from "../interface/Problem";
import {
  compareGrids,
  parseDbSchema,
  parseDbSeed,
  parseExpectedGrid,
  resultIsOrderSensitive,
} from "./DbProblem";
import type { DbComparison, DbGrid, DbSeedTable } from "./DbProblem";
import { PandasUnavailableError, pythonErrorSummary, runPandasAgainstSeed } from "./PandasRunner";
import { hasExecutableSql, runSqlAgainstSeed } from "./SqlEngine";

export interface DbRunOutcome {
  language: DatabaseLanguage;
  /** Tables as they were seeded, for display alongside the result. */
  seed: DbSeedTable[];
  expected: DbGrid | null;
  actual: DbGrid | null;
  comparison: DbComparison | null;
  /** Set when the run could not produce a grid at all. */
  error?: string;
  /** True when the error means the environment is missing, not that the answer is wrong. */
  environmentMissing?: boolean;
  /** True when there was nothing to run yet (empty file, incomplete problem data). */
  notReady?: boolean;
  /** Anything the solution itself printed (pandas mode). */
  stdout?: string;
  /** Set when the answer was read back from a table after a DELETE or UPDATE. */
  dumpedTable?: string;
}

/** Why a problem cannot be run locally, or null when it can. */
export function dbRunBlocker(problem: Problem): string | null {
  if (!parseDbSchema(problem)) {
    return "this problem has no table schema in the LeetCode response, so tables cannot be created locally";
  }
  if (!parseDbSeed(problem)) {
    return "this problem has no example dataset in the LeetCode response, so tables cannot be seeded";
  }
  return null;
}

/**
 * Runs `source` against the problem's seeded tables and compares the result with
 * the statement's expected output. Never throws: failures land in `error`.
 */
export async function runDatabaseSolution(
  problem: Problem,
  language: DatabaseLanguage,
  source: string,
  solutionPath: string,
  onProgress?: (message: string) => void
): Promise<DbRunOutcome> {
  const schema = parseDbSchema(problem);
  const seed = parseDbSeed(problem);
  const expected = parseExpectedGrid(problem.content);
  const base: DbRunOutcome = {
    language,
    seed: seed ?? [],
    expected,
    actual: null,
    comparison: null,
  };
  if (!schema || !seed) {
    return {
      ...base,
      error: dbRunBlocker(problem) ?? "the problem data is incomplete",
      notReady: true,
    };
  }
  if (language === "mysql" && !hasExecutableSql(source)) {
    return { ...base, error: "no SQL statement found in this file yet", notReady: true };
  }

  let actual: DbGrid;
  let stdout: string | undefined;
  let dumpedTable: string | undefined;
  try {
    if (language === "mysql") {
      const result = await runSqlAgainstSeed(source, schema.tables, seed, onProgress);
      actual = result.grid;
      dumpedTable = result.dumpedTable;
    } else {
      const result = await runPandasAgainstSeed(solutionPath, schema, seed);
      actual = result.grid;
      stdout = result.stdout || undefined;
    }
  } catch (e) {
    if (e instanceof PandasUnavailableError) {
      return { ...base, error: e.message, environmentMissing: true };
    }
    const raw = e instanceof Error ? e.message : String(e);
    return { ...base, error: pythonErrorSummary(raw) || raw };
  }

  if (!expected) {
    return {
      ...base,
      actual,
      stdout,
      dumpedTable,
      error: "could not read an expected output table from the problem statement, so nothing was compared",
    };
  }

  return {
    ...base,
    actual,
    stdout,
    dumpedTable,
    comparison: compareGrids(expected, actual, {
      orderSensitive: resultIsOrderSensitive(problem.content),
    }),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DbRunViewModel {
  title: string;
  modeLabel: string;
  verdictClass: "pass" | "fail" | "warn";
  verdictTitle: string;
  verdictDetail: string;
  /** Pre-escaped HTML fragments. */
  notes: string[];
  expected: DbGrid | null;
  actual: DbGrid | null;
  diffRow: number;
  stdout: string;
  seed: DbSeedTable[];
}

/** Everything the results panel renders, derived from an outcome. */
export function buildDbRunViewModel(problem: Problem, outcome: DbRunOutcome): DbRunViewModel {
  const cmp = outcome.comparison;
  let verdictClass: DbRunViewModel["verdictClass"] = "warn";
  let verdictTitle = "Ran, not compared";
  let verdictDetail = "no expected output table was found in the problem statement";
  if (outcome.error) {
    const soft = outcome.environmentMissing || outcome.notReady;
    verdictClass = soft ? "warn" : "fail";
    verdictTitle = outcome.environmentMissing
      ? "Cannot run yet"
      : outcome.notReady
        ? "Nothing to run"
        : "Run failed";
    verdictDetail = outcome.error;
  } else if (cmp?.pass) {
    verdictClass = "pass";
    verdictTitle = "Matches expected output";
    verdictDetail = `${cmp.actualRowCount} row${cmp.actualRowCount === 1 ? "" : "s"}${
      cmp.orderSensitive ? ", in the required order" : ", any order accepted"
    }`;
  } else if (cmp) {
    verdictClass = "fail";
    verdictTitle = "Does not match";
    verdictDetail = cmp.reason ?? "";
  }

  const notes: string[] = [];
  if (outcome.language === "mysql") {
    notes.push(
      "Runs on SQLite with MySQL compatibility shims, not on MySQL itself. A pass here is a strong signal, not a guarantee; submit on LeetCode to be sure."
    );
  }
  if (outcome.dumpedTable) {
    notes.push(
      `Your statement returned no rows, so the contents of <code>${escapeHtml(outcome.dumpedTable)}</code> after it ran were compared instead.`
    );
  }
  if (cmp && !cmp.orderSensitive) {
    notes.push(
      "The statement says any order is acceptable, so rows were compared without regard to order."
    );
  }

  return {
    title: `${problem.id}. ${problem.title}`,
    modeLabel:
      outcome.language === "mysql" ? "MySQL (local SQLite engine)" : "pandas (local python3)",
    verdictClass,
    verdictTitle,
    verdictDetail,
    notes,
    expected: outcome.expected,
    actual: outcome.actual,
    diffRow: cmp?.firstDiffRow ?? -1,
    stdout: outcome.stdout ?? "",
    seed: outcome.seed,
  };
}

/** Short status-bar summary for an outcome. */
export function summarizeOutcome(outcome: DbRunOutcome): string {
  if (outcome.error) return `lcex: ${outcome.error}`;
  const cmp = outcome.comparison;
  if (!cmp) return "lcex: query ran, nothing to compare against";
  if (cmp.pass) {
    return `lcex: matches expected output (${cmp.actualRowCount} row${cmp.actualRowCount === 1 ? "" : "s"}) ✓`;
  }
  return `lcex: ${cmp.reason} ✗`;
}
