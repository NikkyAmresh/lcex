import { describe, it } from "node:test";
import assert from "node:assert";
import type { Problem } from "../src/modules/interface/Problem";
import {
  compareGrids,
  isDatabaseProblem,
  parseDbSchema,
  parseDbSeed,
  parseExpectedGrid,
  renderGrid,
  resultIsOrderSensitive,
} from "../src/modules/database/DbProblem";
import {
  buildDdl,
  isEngineInstalled,
  rewriteMultiTableDelete,
  runSqlAgainstSeed,
  translateMysqlSyntax,
} from "../src/modules/database/SqlEngine";
import { buildDbRunViewModel, runDatabaseSolution } from "../src/modules/database/DbRunner";
import { buildRunPlan } from "../src/modules/database/PandasRunner";
import { generateDbTemplate } from "../src/modules/database/DbTemplate";
import { generateTemplate } from "../src/modules/TemplateEngine";

/**
 * Captured from `questionData` for 175. Combine Two Tables. Note that
 * `sampleTestCase.headers.Person` orders columns differently from the schema:
 * that mismatch is the reason inserts must name their columns.
 */
const COMBINE_TWO_TABLES: Problem = {
  id: "175",
  title: "Combine Two Tables",
  titleSlug: "combine-two-tables",
  difficulty: "Easy",
  categoryTitle: "Database",
  metaData: JSON.stringify({
    mysql: [
      "Create table If Not Exists Person (personId int, firstName varchar(255), lastName varchar(255))",
      "Create table If Not Exists Address (addressId int, personId int, city varchar(255), state varchar(255))",
    ],
    database: true,
    name: "combine_two_tables",
    database_schema: {
      Person: { personId: "INT", firstName: "VARCHAR(255)", lastName: "VARCHAR(255)" },
      Address: {
        addressId: "INT",
        personId: "INT",
        city: "VARCHAR(255)",
        state: "VARCHAR(255)",
      },
    },
  }),
  sampleTestCase: JSON.stringify({
    headers: {
      Person: ["personId", "lastName", "firstName"],
      Address: ["addressId", "personId", "city", "state"],
    },
    rows: {
      Person: [
        [1, "Wang", "Allen"],
        [2, "Alice", "Bob"],
      ],
      Address: [
        [1, 2, "New York City", "New York"],
        [2, 3, "Leetcode", "California"],
      ],
    },
  }),
  codeSnippet: "",
  codeSnippets: {
    mysql: "# Write your MySQL query statement below",
    pythondata:
      "import pandas as pd\n\ndef combine_two_tables(person: pd.DataFrame, address: pd.DataFrame) -> pd.DataFrame:",
  },
  content: `<p>Write a solution to report the first name, last name, city, and state of each person.</p>
<p>Return the result table in <strong>any order</strong>.</p>
<p><strong class="example">Example 1:</strong></p>
<pre>
<strong>Input:</strong>
Person table:
+----------+----------+-----------+
| personId | lastName | firstName |
+----------+----------+-----------+
| 1        | Wang     | Allen     |
| 2        | Alice    | Bob       |
+----------+----------+-----------+
<strong>Output:</strong>
+-----------+----------+---------------+----------+
| firstName | lastName | city          | state    |
+-----------+----------+---------------+----------+
| Allen     | Wang     | Null          | Null     |
| Bob       | Alice    | New York City | New York |
+-----------+----------+---------------+----------+
</pre>`,
};

const TWO_SUM: Problem = {
  id: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  categoryTitle: "Algorithms",
  metaData: JSON.stringify({ name: "twoSum", params: [], return: {} }),
  content: "<p>Given an array of integers.</p>",
  codeSnippet: "function twoSum(nums: number[], target: number): number[] {}",
  codeSnippets: { typescript: "function twoSum(nums: number[], target: number): number[] {}" },
  sampleTestCase: "[2,7,11,15]\n9",
};

const CORRECT_SQL =
  "select p.firstName, p.lastName, a.city, a.state from Person p left join Address a on p.personId = a.personId";

describe("database problem detection", () => {
  it("flags a Database-category problem", () => {
    assert.equal(isDatabaseProblem(COMBINE_TWO_TABLES), true);
  });

  it("does not flag an algorithm problem", () => {
    assert.equal(isDatabaseProblem(TWO_SUM), false);
  });

  it("falls back to code snippets when metaData is absent", () => {
    const noMeta: Problem = { ...COMBINE_TWO_TABLES, metaData: undefined, categoryTitle: undefined };
    assert.equal(isDatabaseProblem(noMeta), true);
  });

  it("treats undefined as not a database problem", () => {
    assert.equal(isDatabaseProblem(undefined), false);
  });
});

describe("schema and seed parsing", () => {
  it("reads both tables and their column types", () => {
    const schema = parseDbSchema(COMBINE_TWO_TABLES);
    assert.ok(schema);
    assert.deepEqual(
      schema.tables.map((t) => t.name),
      ["Person", "Address"]
    );
    assert.equal(schema.functionName, "combine_two_tables");
    assert.deepEqual(schema.tables[0].columns[0], { name: "personId", type: "INT" });
  });

  it("keeps the seed column order from headers, not from the schema", () => {
    const seed = parseDbSeed(COMBINE_TWO_TABLES);
    assert.ok(seed);
    const person = seed.find((t) => t.name === "Person");
    assert.ok(person);
    // Schema order is personId, firstName, lastName; headers order differs.
    assert.deepEqual(person.columns, ["personId", "lastName", "firstName"]);
    assert.deepEqual(person.rows[0], [1, "Wang", "Allen"]);
  });

  it("returns null for a problem with no schema", () => {
    assert.equal(parseDbSchema(TWO_SUM), null);
  });
});

describe("expected output parsing", () => {
  it("reads the grid under the first Output block", () => {
    const grid = parseExpectedGrid(COMBINE_TWO_TABLES.content);
    assert.ok(grid);
    assert.deepEqual(grid.columns, ["firstName", "lastName", "city", "state"]);
    assert.equal(grid.rows.length, 2);
    assert.deepEqual(grid.rows[0], ["Allen", "Wang", "Null", "Null"]);
  });

  it("returns null when there is no grid", () => {
    assert.equal(parseExpectedGrid("<p>Output: 5</p>"), null);
    assert.equal(parseExpectedGrid(""), null);
  });

  it('reads "in any order" as order-insensitive', () => {
    assert.equal(resultIsOrderSensitive(COMBINE_TWO_TABLES.content), false);
    assert.equal(resultIsOrderSensitive("<p>Order the result by visit_date.</p>"), true);
  });

  it("round-trips a grid through the ASCII renderer", () => {
    const grid = parseExpectedGrid(COMBINE_TWO_TABLES.content);
    assert.ok(grid);
    assert.deepEqual(parseExpectedGrid(`Output:\n${renderGrid(grid)}`), grid);
  });
});

describe("grid comparison", () => {
  const expected = { columns: ["a", "b"], rows: [["1", "x"], ["2", "y"]] };

  it("passes on an exact match", () => {
    const cmp = compareGrids(expected, expected, { orderSensitive: true });
    assert.equal(cmp.pass, true);
  });

  it("unifies null spellings and numeric formatting", () => {
    const actual = { columns: ["a", "b"], rows: [[1, "x"], [2.0, "y"]] };
    assert.equal(compareGrids(expected, actual, { orderSensitive: true }).pass, true);
    const nulls = compareGrids(
      { columns: ["a"], rows: [["Null"]] },
      { columns: ["a"], rows: [[null]] },
      { orderSensitive: true }
    );
    assert.equal(nulls.pass, true);
  });

  it("treats 3.5 and 3.50 as equal", () => {
    const cmp = compareGrids(
      { columns: ["r"], rows: [["3.50"]] },
      { columns: ["r"], rows: [[3.5]] },
      { orderSensitive: true }
    );
    assert.equal(cmp.pass, true);
  });

  it("accepts reordered rows only when order does not matter", () => {
    const shuffled = { columns: ["a", "b"], rows: [["2", "y"], ["1", "x"]] };
    assert.equal(compareGrids(expected, shuffled, { orderSensitive: false }).pass, true);
    const ordered = compareGrids(expected, shuffled, { orderSensitive: true });
    assert.equal(ordered.pass, false);
    assert.equal(ordered.firstDiffRow, 0);
  });

  it("reports a column mismatch before looking at rows", () => {
    const cmp = compareGrids(
      expected,
      { columns: ["a"], rows: [["1"]] },
      { orderSensitive: true }
    );
    assert.equal(cmp.pass, false);
    assert.match(cmp.reason ?? "", /columns differ/);
  });

  it("reports a row count mismatch", () => {
    const cmp = compareGrids(
      expected,
      { columns: ["a", "b"], rows: [["1", "x"]] },
      { orderSensitive: false }
    );
    assert.equal(cmp.pass, false);
    assert.match(cmp.reason ?? "", /row count differs/);
  });

  it("ignores column name casing", () => {
    const cmp = compareGrids(
      { columns: ["Salary"], rows: [["1"]] },
      { columns: ["salary"], rows: [["1"]] },
      { orderSensitive: true }
    );
    assert.equal(cmp.pass, true);
  });
});

describe("MySQL to SQLite translation", () => {
  it("maps ENUM columns to TEXT so SQLite can parse the DDL", () => {
    const ddl = buildDdl([
      { name: "Trips", columns: [{ name: "status", type: "ENUM('a', 'b')" }, { name: "id", type: "INT" }] },
    ]);
    assert.equal(ddl.length, 1);
    assert.match(ddl[0], /"status" TEXT/);
    assert.match(ddl[0], /"id" INTEGER/);
  });

  it("forces float division, as MySQL does", () => {
    assert.equal(translateMysqlSyntax("select a / b"), "select a * 1.0 / b");
  });

  it("rewrites INTERVAL arguments", () => {
    assert.equal(
      translateMysqlSyntax("select date_add(d, interval 1 day)"),
      "select date_add(d, 1, 'DAY')"
    );
    assert.match(translateMysqlSyntax("select d + interval 1 day"), /date_add\(d, 1, 'DAY'\)/);
    assert.match(translateMysqlSyntax("select d - interval 2 month"), /date_sub\(d, 2, 'MONTH'\)/);
  });

  it("rewrites bare unit keywords in TIMESTAMPDIFF", () => {
    assert.match(translateMysqlSyntax("select timestampdiff(DAY, a, b)"), /timestampdiff\('DAY',/);
  });

  it("converts backticks and GROUP_CONCAT SEPARATOR", () => {
    assert.equal(translateMysqlSyntax("select `odd name`"), 'select "odd name"');
    assert.equal(
      translateMysqlSyntax("select group_concat(x separator ',')"),
      "select group_concat(x, ',')"
    );
  });

  it("leaves string literals and comments untouched", () => {
    assert.equal(translateMysqlSyntax("select 'a/b'"), "select 'a/b'");
    assert.equal(translateMysqlSyntax("select 'interval 1 day'"), "select 'interval 1 day'");
    assert.equal(translateMysqlSyntax("-- a / b\nselect 1"), "-- a / b\nselect 1");
  });

  it("rewrites MySQL multi-table DELETE into a rowid subquery", () => {
    const out = rewriteMultiTableDelete(
      "DELETE p1 FROM Person p1, Person p2 WHERE p1.Email = p2.Email AND p1.Id > p2.Id"
    );
    assert.match(out, /^DELETE FROM "Person" WHERE rowid IN \(SELECT p1\.rowid FROM Person p1/);
  });

  it("leaves a plain DELETE alone", () => {
    const plain = "DELETE FROM Person WHERE Id > 1";
    assert.equal(rewriteMultiTableDelete(plain), plain);
  });
});

describe("solution templates", () => {
  it("writes the schema, seed rows and expected grid into a .sql file", () => {
    const sql = generateDbTemplate(COMBINE_TWO_TABLES, "mysql");
    assert.match(sql, /^-- 175\. Combine Two Tables/);
    assert.match(sql, /-- {3}Person\(personId INT, firstName VARCHAR\(255\)/);
    assert.match(sql, /Example input/);
    assert.match(sql, /Expected output/);
    assert.match(sql, /# Write your MySQL query statement below/);
    assert.ok(
      sql.split("\n").every((l) => l === l.trimEnd()),
      "template must not leave trailing whitespace"
    );
  });

  it("uses the pandas snippet and adds a body placeholder", () => {
    const py = generateDbTemplate(COMBINE_TWO_TABLES, "pandas");
    assert.match(py, /^# 175\. Combine Two Tables/);
    assert.match(py, /def combine_two_tables\(person: pd\.DataFrame/);
    assert.match(py, /# TODO/);
  });

  it("is reached through generateTemplate for database languages", () => {
    assert.equal(
      generateTemplate(COMBINE_TWO_TABLES, { language: "mysql" }),
      generateDbTemplate(COMBINE_TWO_TABLES, "mysql")
    );
  });
});

describe("pandas run plan", () => {
  it("pairs each seeded column with a dtype from the schema", () => {
    const schema = parseDbSchema(COMBINE_TWO_TABLES);
    const seed = parseDbSeed(COMBINE_TWO_TABLES);
    assert.ok(schema && seed);
    const plan = buildRunPlan(schema, seed);
    assert.equal(plan.functionName, "combine_two_tables");
    const person = plan.tables.find((t) => t.name === "Person");
    assert.ok(person);
    assert.equal(person.dtypes.personId, "Int64");
    assert.equal(person.dtypes.firstName, "object");
  });

  it("maps date columns to datetime64", () => {
    const plan = buildRunPlan(
      { functionName: "f", tables: [{ name: "W", columns: [{ name: "d", type: "DATE" }] }] },
      [{ name: "W", columns: ["d"], rows: [["2019-01-01"]] }]
    );
    assert.equal(plan.tables[0].dtypes.d, "datetime64[ns]");
  });
});

describe("run outcomes", () => {
  it("blocks with a clear reason when the problem data is incomplete", async () => {
    const outcome = await runDatabaseSolution(TWO_SUM, "mysql", "select 1", "/tmp/x.sql");
    assert.equal(outcome.notReady, true);
    assert.match(outcome.error ?? "", /no table schema/);
    const vm = buildDbRunViewModel(TWO_SUM, outcome);
    assert.equal(vm.verdictClass, "warn");
  });

  it("reports an empty file as nothing to run", async () => {
    const outcome = await runDatabaseSolution(
      COMBINE_TWO_TABLES,
      "mysql",
      "-- not written yet\n",
      "/tmp/x.sql"
    );
    assert.equal(outcome.notReady, true);
    assert.equal(buildDbRunViewModel(COMBINE_TWO_TABLES, outcome).verdictTitle, "Nothing to run");
  });

  it("always states that the MySQL run is on SQLite", () => {
    const vm = buildDbRunViewModel(COMBINE_TWO_TABLES, {
      language: "mysql",
      seed: [],
      expected: null,
      actual: null,
      comparison: null,
    });
    assert.ok(vm.notes.some((n) => /SQLite/.test(n)));
  });
});

// The engine is downloaded on first use rather than bundled, so these only run
// once it is present. `npm run compile` does not fetch it.
describe("local SQL execution", async () => {
  const installed = await isEngineInstalled();
  const maybe = installed ? it : it.skip;

  maybe("matches the expected grid for a correct query", async () => {
    const schema = parseDbSchema(COMBINE_TWO_TABLES);
    const seed = parseDbSeed(COMBINE_TWO_TABLES);
    assert.ok(schema && seed);
    const result = await runSqlAgainstSeed(CORRECT_SQL, schema.tables, seed);
    const expected = parseExpectedGrid(COMBINE_TWO_TABLES.content);
    assert.ok(expected);
    const cmp = compareGrids(expected, result.grid, { orderSensitive: false });
    assert.equal(cmp.pass, true, cmp.reason);
  });

  maybe("inserts rows by name despite the header/schema order mismatch", async () => {
    const schema = parseDbSchema(COMBINE_TWO_TABLES);
    const seed = parseDbSeed(COMBINE_TWO_TABLES);
    assert.ok(schema && seed);
    const result = await runSqlAgainstSeed(
      "select firstName from Person where personId = 1",
      schema.tables,
      seed
    );
    assert.deepEqual(result.grid.rows, [["Allen"]]);
  });

  maybe("surfaces a SQL error message", async () => {
    const schema = parseDbSchema(COMBINE_TWO_TABLES);
    const seed = parseDbSeed(COMBINE_TWO_TABLES);
    assert.ok(schema && seed);
    await assert.rejects(
      () => runSqlAgainstSeed("select * from Nope", schema.tables, seed),
      /no such table: Nope/
    );
  });

  maybe("divides as MySQL does rather than truncating", async () => {
    const result = await runSqlAgainstSeed(
      "select sum(case when personId = 1 then 1 else 0 end) / count(*) as r from Person",
      parseDbSchema(COMBINE_TWO_TABLES)!.tables,
      parseDbSeed(COMBINE_TWO_TABLES)!
    );
    assert.equal(result.grid.rows[0][0], 0.5);
  });

  maybe("rounds .5 away from zero like MySQL", async () => {
    const result = await runSqlAgainstSeed(
      "select round(2.675, 2) as a, round(0.125, 2) as b",
      parseDbSchema(COMBINE_TWO_TABLES)!.tables,
      parseDbSeed(COMBINE_TWO_TABLES)!
    );
    assert.deepEqual(result.grid.rows[0], [2.68, 0.13]);
  });
});
