/**
 * Local SQL execution for LeetCode database problems, backed by SQLite compiled
 * to WebAssembly (sql.js).
 *
 * The engine is not bundled in the .vsix: the two assets are ~700 KB and only
 * matter to people who solve database problems, so they are fetched once into
 * `~/.lcex/engines/` and verified against pinned SHA-256 digests before being
 * loaded. A digest mismatch deletes the file and fails the run.
 *
 * SQLite is not MySQL. `translateMysqlSyntax` rewrites the grammar SQLite's
 * parser rejects, and `MYSQL_COMPAT_FUNCTIONS` fills in the builtins it lacks.
 * Together they cover what LeetCode problems actually use; anything outside that
 * set surfaces as a normal SQL error naming the missing function.
 */
import * as crypto from "crypto";
import * as fs from "fs/promises";
import { createRequire } from "module";
import * as os from "os";
import * as path from "path";
import type { DbCell, DbGrid, DbSeedTable, DbTableSchema } from "./DbProblem";

const SQLJS_VERSION = "1.13.0";
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist`;

/** Pinned digests for sql.js 1.13.0; a download that fails these is discarded. */
const SQLJS_ASSETS: ReadonlyArray<{ file: string; sha256: string }> = [
  {
    file: "sql-wasm.js",
    sha256: "694ca5b36aa3e6e71f417819d7df390b65343665fcfa5c69015ca33d93d291b3",
  },
  {
    file: "sql-wasm.wasm",
    sha256: "0734155c83e493983d1f2ff5b09a4fab6e35a32e9449c7e4e545756439f62d73",
  },
];

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Total bytes fetched on first use, quoted in the consent prompt. */
export const ENGINE_DOWNLOAD_BYTES = 708_594;
export const ENGINE_LABEL = `sql.js ${SQLJS_VERSION} (SQLite compiled to WebAssembly)`;

export function engineDir(): string {
  return path.join(os.homedir(), ".lcex", "engines", `sql.js-${SQLJS_VERSION}`);
}

async function digestOf(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function downloadAsset(file: string, expected: string, dest: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let body: Buffer;
  try {
    const res = await globalThis.fetch(`${SQLJS_BASE}/${file}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${file}`);
    body = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
  const actual = crypto.createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${file} failed its integrity check (expected ${expected.slice(0, 12)}, got ${actual.slice(0, 12)}). Download refused.`
    );
  }
  // Write under a temp name so an interrupted download never leaves a truncated asset.
  const tmp = `${dest}.${process.pid}.part`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, dest);
}

/** True when both engine assets are present and pass their digest check. */
export async function isEngineInstalled(): Promise<boolean> {
  const dir = engineDir();
  for (const { file, sha256 } of SQLJS_ASSETS) {
    if ((await digestOf(path.join(dir, file))) !== sha256) return false;
  }
  return true;
}

/**
 * Ensures the engine assets exist locally, downloading any that are missing or
 * corrupt. Returns the directory holding them.
 */
export async function ensureEngineInstalled(
  onProgress?: (message: string) => void
): Promise<string> {
  const dir = engineDir();
  await fs.mkdir(dir, { recursive: true });
  for (const { file, sha256 } of SQLJS_ASSETS) {
    const dest = path.join(dir, file);
    if ((await digestOf(dest)) === sha256) continue;
    onProgress?.(`downloading ${file}`);
    await fs.rm(dest, { force: true });
    await downloadAsset(file, sha256, dest);
  }
  return dir;
}

interface SqlJsStatementResult {
  columns: string[];
  values: DbCell[][];
}

interface SqlJsDatabase {
  run(sql: string, params?: DbCell[]): void;
  exec(sql: string): SqlJsStatementResult[];
  create_function(name: string, fn: (...args: DbCell[]) => DbCell): void;
  close(): void;
}

interface SqlJsModule {
  Database: new () => SqlJsDatabase;
}

let sqlJsPromise: Promise<SqlJsModule> | null = null;

async function loadSqlJs(onProgress?: (message: string) => void): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const dir = await ensureEngineInstalled(onProgress);
      // Resolved from disk at runtime, so it must stay outside esbuild's dependency graph.
      const req = createRequire(__filename);
      const initSqlJs = req(path.join(dir, "sql-wasm.js")) as (cfg: {
        locateFile: (f: string) => string;
      }) => Promise<SqlJsModule>;
      return initSqlJs({ locateFile: (f: string) => path.join(dir, f) });
    })().catch((e) => {
      sqlJsPromise = null;
      throw e;
    });
  }
  return sqlJsPromise;
}

/** MySQL type to one SQLite's parser accepts (ENUM and SET are not valid there). */
function sqliteType(mysqlType: string): string {
  const t = mysqlType.trim().toUpperCase();
  if (/^ENUM|^SET/.test(t)) return "TEXT";
  if (/^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|BIT|BOOL)/.test(t)) return "INTEGER";
  if (/^(DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)/.test(t)) return "REAL";
  return "TEXT";
}

/** `CREATE TABLE` statements for the problem's schema, in SQLite's dialect. */
export function buildDdl(tables: readonly DbTableSchema[]): string[] {
  return tables.map((t) => {
    const cols = t.columns.map((c) => `"${c.name}" ${sqliteType(c.type)}`).join(", ");
    return `CREATE TABLE IF NOT EXISTS "${t.name}" (${cols})`;
  });
}

const INTERVAL_UNIT = "YEAR|QUARTER|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND";

/**
 * Splits SQL into alternating code and literal segments so rewrites never touch
 * the inside of a string literal or comment. Index 0 is always code.
 */
function segmentSql(sql: string): { text: string; isCode: boolean }[] {
  const out: { text: string; isCode: boolean }[] = [];
  let code = "";
  let i = 0;
  const pushLiteral = (text: string) => {
    out.push({ text: code, isCode: true });
    out.push({ text, isCode: false });
    code = "";
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== ch) j += sql[j] === "\\" ? 2 : 1;
      pushLiteral(sql.slice(i, Math.min(j + 1, sql.length)));
      i = j + 1;
      continue;
    }
    if ((ch === "-" && next === "-") || ch === "#") {
      const end = sql.indexOf("\n", i);
      pushLiteral(sql.slice(i, end < 0 ? sql.length : end));
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      pushLiteral(sql.slice(i, end < 0 ? sql.length : end + 2));
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    code += ch;
    i++;
  }
  out.push({ text: code, isCode: true });
  return out;
}

/**
 * Rewrites the MySQL-only grammar SQLite's parser rejects. Backticks become
 * double quotes, `INTERVAL n UNIT` becomes ordinary arguments to the date UDFs,
 * and unit keywords used as bare identifiers become string literals.
 *
 * Applied only to code segments, so a string literal containing "INTERVAL" is
 * left alone.
 */
export function translateMysqlSyntax(sql: string): string {
  return segmentSql(sql)
    .map(({ text, isCode }) => {
      if (!isCode) {
        // Backtick-quoted identifiers still need requoting for SQLite.
        return text.startsWith("`") ? `"${text.slice(1, -1)}"` : text;
      }
      return (
        text
          // `d + INTERVAL 1 DAY` / `d - INTERVAL 1 DAY` -> date_add/date_sub calls.
          .replace(
            new RegExp(
              `([\\w."')\\]]+)\\s*([+-])\\s*INTERVAL\\s+([\\w.'"]+)\\s+(${INTERVAL_UNIT})S?\\b`,
              "gi"
            ),
            (_m, left, op, amount, unit) =>
              `${op === "+" ? "date_add" : "date_sub"}(${left}, ${amount}, '${unit.toUpperCase()}')`
          )
          // Remaining `DATE_ADD(d, INTERVAL 1 DAY)` argument form.
          .replace(
            new RegExp(`INTERVAL\\s+([\\w.'"]+)\\s+(${INTERVAL_UNIT})S?\\b`, "gi"),
            (_m, amount, unit) => `${amount}, '${unit.toUpperCase()}'`
          )
          // TIMESTAMPDIFF(DAY, a, b): the unit is a bare keyword in MySQL.
          .replace(
            new RegExp(`\\b(TIMESTAMPDIFF|TIMESTAMPADD)\\s*\\(\\s*(${INTERVAL_UNIT})S?\\s*,`, "gi"),
            (_m, fn, unit) => `${fn}('${unit.toUpperCase()}',`
          )
          // GROUP_CONCAT(x SEPARATOR ', ') -> GROUP_CONCAT(x, ', ')
          .replace(/\s*\bSEPARATOR\s+/gi, ", ")
          // MySQL cast targets SQLite does not name the same way.
          .replace(/\bAS\s+SIGNED(\s+INTEGER)?\b/gi, "AS INTEGER")
          .replace(/\bAS\s+UNSIGNED(\s+INTEGER)?\b/gi, "AS INTEGER")
          // MySQL `/` is always float division; SQLite truncates when both sides are
          // integers, which silently zeroes every `sum(...) / count(*)` percentage.
          // `*` and `/` share precedence and associate left, so `a / b` -> `a * 1.0 / b`
          // preserves grouping at every nesting level.
          .replace(/\//g, "* 1.0 /")
      );
    })
    .join("");
}

/**
 * MySQL's multi-table delete (`DELETE p1 FROM Person p1, Person p2 WHERE ...`) has
 * no SQLite equivalent, and it is how the classic duplicate-row problems are
 * written. Rewrites it into a `rowid IN (...)` subquery over the same FROM clause,
 * which is semantically identical for the single-target form MySQL allows here.
 *
 * Returns `stmt` unchanged when it is not that shape.
 */
export function rewriteMultiTableDelete(stmt: string): string {
  const m = /^\s*DELETE\s+([A-Za-z_$][\w$]*)\s+FROM\s+([\s\S]+)$/i.exec(stmt);
  if (!m) return stmt;
  const [, alias, rest] = m;
  if (/^from$/i.test(alias)) return stmt;
  const table = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s+(?:AS\\s+)?${alias}\\b`, "i").exec(rest);
  if (!table) return stmt;
  return `DELETE FROM "${table[1]}" WHERE rowid IN (SELECT ${alias}.rowid FROM ${rest})`;
}

type Udf = (...args: DbCell[]) => DbCell;

function asNumber(v: DbCell): number {
  return typeof v === "number" ? v : Number(v);
}

function asDate(v: DbCell): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(" ", "T") + "Z");
  if (!Number.isNaN(ms)) return new Date(ms);
  const plain = Date.parse(s);
  return Number.isNaN(plain) ? null : new Date(plain);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDate(v: DbCell, amount: DbCell, unit: DbCell, sign: number): DbCell {
  const d = asDate(v);
  const n = asNumber(amount);
  if (!d || !Number.isFinite(n)) return null;
  const u = String(unit ?? "DAY").toUpperCase();
  const delta = sign * n;
  if (u.startsWith("YEAR")) d.setUTCFullYear(d.getUTCFullYear() + delta);
  else if (u.startsWith("QUARTER")) d.setUTCMonth(d.getUTCMonth() + delta * 3);
  else if (u.startsWith("MONTH")) d.setUTCMonth(d.getUTCMonth() + delta);
  else if (u.startsWith("WEEK")) d.setUTCDate(d.getUTCDate() + delta * 7);
  else if (u.startsWith("HOUR")) d.setUTCHours(d.getUTCHours() + delta);
  else if (u.startsWith("MINUTE")) d.setUTCMinutes(d.getUTCMinutes() + delta);
  else if (u.startsWith("SECOND")) d.setUTCSeconds(d.getUTCSeconds() + delta);
  else d.setUTCDate(d.getUTCDate() + delta);
  return isoDate(d);
}

function diffUnits(unit: DbCell, from: DbCell, to: DbCell): DbCell {
  const a = asDate(from);
  const b = asDate(to);
  if (!a || !b) return null;
  const u = String(unit ?? "DAY").toUpperCase();
  const ms = b.getTime() - a.getTime();
  if (u.startsWith("SECOND")) return Math.trunc(ms / 1000);
  if (u.startsWith("MINUTE")) return Math.trunc(ms / 60_000);
  if (u.startsWith("HOUR")) return Math.trunc(ms / 3_600_000);
  if (u.startsWith("WEEK")) return Math.trunc(ms / (7 * 86_400_000));
  if (u.startsWith("YEAR") || u.startsWith("MONTH") || u.startsWith("QUARTER")) {
    const months =
      (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    const partial = b.getUTCDate() < a.getUTCDate() ? -1 : 0;
    const total = months + partial;
    if (u.startsWith("MONTH")) return total;
    if (u.startsWith("QUARTER")) return Math.trunc(total / 3);
    return Math.trunc(total / 12);
  }
  return Math.trunc(ms / 86_400_000);
}

function matchesRegexp(value: DbCell, pattern: DbCell): DbCell {
  if (value === null || pattern === null) return null;
  try {
    return new RegExp(String(pattern), "i").test(String(value)) ? 1 : 0;
  } catch {
    return 0;
  }
}

function truthy(v: DbCell): boolean {
  return v !== null && v !== 0 && v !== "0" && v !== false && v !== "";
}

/**
 * MySQL rounds .5 away from zero; SQLite rounds half to even. Problems asking for
 * a 2-decimal percentage depend on the MySQL behaviour.
 */
function mysqlRound(v: DbCell, digits: DbCell): DbCell {
  const x = asNumber(v);
  if (!Number.isFinite(x)) return null;
  const places = digits === null || digits === undefined ? 0 : asNumber(digits);
  const factor = 10 ** places;
  const scaled = x * factor;
  // Nudge by a few ulps so 2.675 * 100 = 267.49999999999997 still rounds up.
  const eps = Math.abs(scaled) * Number.EPSILON * 4;
  const rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled) + eps + 0.5);
  return rounded / factor;
}

/**
 * MySQL builtins SQLite 3.49 lacks. Keys are `name/arity`: sql.js derives the
 * registered arity from `fn.length`, so each arity needs its own entry and rest
 * parameters cannot be used.
 */
const MYSQL_COMPAT_FUNCTIONS: Record<string, Udf> = {
  // SQLite desugars `X REGEXP Y` into `regexp(Y, X)`, which covers RLIKE too.
  "regexp/2": (pattern, value) => matchesRegexp(value, pattern),
  "regexp_like/2": (value, pattern) => matchesRegexp(value, pattern),
  "if/3": (cond, whenTrue, whenFalse) => (truthy(cond) ? whenTrue : whenFalse),
  "isnull/1": (v) => (v === null ? 1 : 0),
  "datediff/2": (a, b) => diffUnits("DAY", b, a),
  "timestampdiff/3": (unit, from, to) => diffUnits(unit, from, to),
  "timestampadd/3": (unit, amount, v) => shiftDate(v, amount, unit, 1),
  "date_add/3": (v, amount, unit) => shiftDate(v, amount, unit, 1),
  "date_sub/3": (v, amount, unit) => shiftDate(v, amount, unit, -1),
  "adddate/2": (v, amount) => shiftDate(v, amount, "DAY", 1),
  "adddate/3": (v, amount, unit) => shiftDate(v, amount, unit, 1),
  "subdate/2": (v, amount) => shiftDate(v, amount, "DAY", -1),
  "subdate/3": (v, amount, unit) => shiftDate(v, amount, unit, -1),
  "year/1": (v) => asDate(v)?.getUTCFullYear() ?? null,
  "month/1": (v) => {
    const d = asDate(v);
    return d ? d.getUTCMonth() + 1 : null;
  },
  "quarter/1": (v) => {
    const d = asDate(v);
    return d ? Math.floor(d.getUTCMonth() / 3) + 1 : null;
  },
  "day/1": (v) => asDate(v)?.getUTCDate() ?? null,
  "dayofmonth/1": (v) => asDate(v)?.getUTCDate() ?? null,
  "dayofweek/1": (v) => {
    const d = asDate(v);
    return d ? d.getUTCDay() + 1 : null;
  },
  "weekday/1": (v) => {
    const d = asDate(v);
    return d ? (d.getUTCDay() + 6) % 7 : null;
  },
  "last_day/1": (v) => {
    const d = asDate(v);
    return d ? isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) : null;
  },
  "date/1": (v) => {
    const d = asDate(v);
    return d ? isoDate(d) : null;
  },
  "str_to_date/2": (v) => {
    const d = asDate(v);
    return d ? isoDate(d) : null;
  },
  "date_format/2": (v, fmt) => {
    const d = asDate(v);
    if (!d || fmt === null) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return String(fmt)
      .replace(/%Y/g, String(d.getUTCFullYear()))
      .replace(/%y/g, pad(d.getUTCFullYear() % 100))
      .replace(/%m/g, pad(d.getUTCMonth() + 1))
      .replace(/%d/g, pad(d.getUTCDate()))
      .replace(/%H/g, pad(d.getUTCHours()))
      .replace(/%i/g, pad(d.getUTCMinutes()))
      .replace(/%s/g, pad(d.getUTCSeconds()));
  },
  "left/2": (v, n) => (v === null ? null : String(v).slice(0, Math.max(0, asNumber(n)))),
  "right/2": (v, n) => {
    if (v === null) return null;
    const count = asNumber(n);
    return count <= 0 ? "" : String(v).slice(-count);
  },
  "locate/2": (needle, haystack) =>
    needle === null || haystack === null ? null : String(haystack).indexOf(String(needle)) + 1,
  "locate/3": (needle, haystack, from) =>
    needle === null || haystack === null
      ? null
      : String(haystack).indexOf(String(needle), Math.max(0, asNumber(from) - 1)) + 1,
  "repeat/2": (v, n) => (v === null ? null : String(v).repeat(Math.max(0, asNumber(n)))),
  "space/1": (n) => " ".repeat(Math.max(0, asNumber(n))),
  "char_length/1": (v) => (v === null ? null : String(v).length),
  "character_length/1": (v) => (v === null ? null : String(v).length),
  "ascii/1": (v) => (v === null || String(v) === "" ? null : String(v).charCodeAt(0)),
  "substring_index/3": (v, delim, count) => {
    if (v === null || delim === null) return null;
    const parts = String(v).split(String(delim));
    const n = asNumber(count);
    return n >= 0 ? parts.slice(0, n).join(String(delim)) : parts.slice(n).join(String(delim));
  },
  "truncate/2": (v, n) => {
    const x = asNumber(v);
    const places = asNumber(n);
    if (!Number.isFinite(x) || !Number.isFinite(places)) return null;
    const factor = 10 ** places;
    return Math.trunc(x * factor) / factor;
  },
  "mod/2": (a, b) => {
    const y = asNumber(b);
    return y === 0 ? null : asNumber(a) % y;
  },
  "pow/2": (a, b) => asNumber(a) ** asNumber(b),
  "ceiling/1": (v) => Math.ceil(asNumber(v)),
  "least/2": (a, b) => (a === null || b === null ? null : asNumber(a) <= asNumber(b) ? a : b),
  "greatest/2": (a, b) => (a === null || b === null ? null : asNumber(a) >= asNumber(b) ? a : b),
  "rand/0": () => 0.5,
  "now/0": () => "1970-01-01 00:00:00",
  "curdate/0": () => "1970-01-01",
  "current_date/0": () => "1970-01-01",
  "round/1": (v) => mysqlRound(v, 0),
  "round/2": (v, d) => mysqlRound(v, d),
};

function registerCompat(db: SqlJsDatabase): void {
  for (const [key, fn] of Object.entries(MYSQL_COMPAT_FUNCTIONS)) {
    const name = key.slice(0, key.lastIndexOf("/"));
    db.create_function(name, fn);
  }
}

/** Statements that only mutate state; used to decide whether to dump a table as the answer. */
const MUTATING_STATEMENT = /^\s*(delete|update|insert|replace|drop|alter|truncate)\b/i;

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const { text, isCode } of segmentSql(sql)) {
    if (!isCode) {
      // Comments carry no statement content; literals must stay attached verbatim.
      if (!text.startsWith("--") && !text.startsWith("#") && !text.startsWith("/*")) {
        current += text;
      }
      continue;
    }
    const parts = text.split(";");
    for (let i = 0; i < parts.length; i++) {
      current += parts[i];
      if (i < parts.length - 1) {
        if (current.trim()) out.push(current.trim());
        current = "";
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** True when the file contains at least one statement (not just comments). */
export function hasExecutableSql(sql: string): boolean {
  return splitStatements(sql).length > 0;
}

export interface SqlRunResult {
  grid: DbGrid;
  /** True when the answer came from dumping a table after a mutation rather than a SELECT. */
  fromTableDump: boolean;
  dumpedTable?: string;
}

/**
 * Creates the problem's tables, seeds them, runs `sql`, and returns the grid to
 * compare against. Throws with SQLite's own message when a statement fails.
 */
export async function runSqlAgainstSeed(
  sql: string,
  schema: readonly DbTableSchema[],
  seed: readonly DbSeedTable[],
  onProgress?: (message: string) => void
): Promise<SqlRunResult> {
  const SQL = await loadSqlJs(onProgress);
  const db = new SQL.Database();
  try {
    registerCompat(db);
    for (const stmt of buildDdl(schema)) db.run(stmt);
    for (const table of seed) {
      if (table.rows.length === 0) continue;
      const cols = table.columns.map((c) => `"${c}"`).join(", ");
      const placeholders = table.columns.map(() => "?").join(", ");
      const insert = `INSERT INTO "${table.name}" (${cols}) VALUES (${placeholders})`;
      for (const row of table.rows) {
        // Pad short rows so one malformed tuple cannot abort the whole run.
        db.run(
          insert,
          table.columns.map((_, i) => (i < row.length ? row[i] : null))
        );
      }
    }

    const statements = splitStatements(sql);
    if (statements.length === 0) {
      throw new Error("no SQL statement found in this file");
    }
    let lastResult: SqlJsStatementResult | null = null;
    let sawMutation = false;
    for (const raw of statements) {
      if (MUTATING_STATEMENT.test(raw)) sawMutation = true;
      const stmt = rewriteMultiTableDelete(translateMysqlSyntax(raw));
      const results = db.exec(stmt);
      if (results.length > 0) lastResult = results[results.length - 1];
    }

    if (lastResult) {
      return { grid: { columns: lastResult.columns, rows: lastResult.values }, fromTableDump: false };
    }

    // DELETE/UPDATE problems: the answer is the table's final state. Only
    // unambiguous when the problem has a single table.
    if (sawMutation && schema.length === 1) {
      const name = schema[0].name;
      const dumped = db.exec(`SELECT * FROM "${name}"`);
      const result = dumped[0] ?? { columns: schema[0].columns.map((c) => c.name), values: [] };
      return {
        grid: { columns: result.columns, rows: result.values },
        fromTableDump: true,
        dumpedTable: name,
      };
    }

    throw new Error(
      sawMutation
        ? "the statement returned no rows, and this problem has more than one table so the final state is ambiguous"
        : "the statement returned no result set"
    );
  } finally {
    db.close();
  }
}
