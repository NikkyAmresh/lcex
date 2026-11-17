import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Prefix of the per-assert result lines the harness writes to stdout. */
export const PY_ASSERT_MARKER = "__LCEX_ASSERT__";

/**
 * Runs a Python solution file with every top-level `assert` rewritten into a
 * non-fatal check, so one failing example does not hide the rest. Each check
 * prints `__LCEX_ASSERT__{"line", "pass", "actual", "expected"}` on its own line.
 * Asserts inside `def` / `class` bodies are left alone (they are the user's own
 * invariants, not examples). `==` compares floats with a 1e-5 tolerance, like LeetCode.
 */
const HARNESS_SOURCE = String.raw`
import ast, json, math, os, sys, traceback

_MARK = "${PY_ASSERT_MARKER}"


def _repr(v):
    try:
        s = repr(v)
    except Exception:
        s = "<unrepresentable>"
    return s if len(s) <= 300 else s[:297] + "..."


def _err(e):
    return "%s: %s" % (type(e).__name__, e)


def _call(f):
    try:
        return True, f()
    except Exception as e:
        return False, _err(e)


def _close(a, b):
    try:
        if bool(a == b):
            return True
    except Exception:
        pass
    if isinstance(a, bool) or isinstance(b, bool):
        return False
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=0.0, abs_tol=1e-5)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    return False


def _emit(line, ok, actual, expected):
    sys.stdout.write("\n" + _MARK + json.dumps(
        {"line": line, "pass": bool(ok), "actual": actual, "expected": expected}) + "\n")
    sys.stdout.flush()


def _lcex_eq(line, left, right):
    ok_a, a = _call(left)
    ok_b, b = _call(right)
    expected = _repr(b) if ok_b else b
    if not ok_a:
        _emit(line, False, a, expected)
    elif not ok_b:
        _emit(line, False, _repr(a), expected)
    else:
        _emit(line, _close(a, b), _repr(a), expected)


def _lcex_truthy(line, test):
    ok, v = _call(test)
    if not ok:
        _emit(line, False, v, "True")
        return
    try:
        passed = bool(v)
    except Exception as e:
        _emit(line, False, _err(e), "True")
        return
    _emit(line, passed, _repr(v), "True")


def _thunk(expr):
    lam = ast.parse("lambda: 0", mode="eval").body
    lam.body = expr
    return lam


class _Rewrite(ast.NodeTransformer):
    def _skip(self, node):
        return node

    visit_FunctionDef = _skip
    visit_AsyncFunctionDef = _skip
    visit_ClassDef = _skip
    visit_Lambda = _skip

    def visit_Assert(self, node):
        t = node.test
        line = ast.Constant(node.lineno)
        if isinstance(t, ast.Compare) and len(t.ops) == 1 and isinstance(t.ops[0], ast.Eq):
            call = ast.Call(ast.Name("_lcex_eq", ast.Load()),
                            [line, _thunk(t.left), _thunk(t.comparators[0])], [])
        else:
            call = ast.Call(ast.Name("_lcex_truthy", ast.Load()), [line, _thunk(t)], [])
        return ast.copy_location(ast.Expr(call), node)


def main():
    path = os.path.abspath(sys.argv[1])
    with open(path, "rb") as f:
        src = f.read()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
        sys.exit(1)
    tree = ast.fix_missing_locations(_Rewrite().visit(tree))
    code = compile(tree, path, "exec", dont_inherit=True)
    sys.argv = [path] + sys.argv[2:]
    sys.path[0] = os.path.dirname(path)
    g = {"__name__": "__main__", "__file__": path, "__builtins__": __builtins__,
         "_lcex_eq": _lcex_eq, "_lcex_truthy": _lcex_truthy}
    try:
        exec(code, g)
    except SystemExit:
        raise
    except BaseException as e:
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        traceback.print_exception(type(e), e, tb)
        sys.exit(1)


main()
`;

let harnessPath: Promise<string> | null = null;

/** Writes the harness to the temp dir once per extension-host process; returns its path. */
export function ensurePythonAssertHarness(): Promise<string> {
  if (!harnessPath) {
    const p = path.join(os.tmpdir(), `lcex-py-assert-${process.pid}.py`);
    harnessPath = fs.writeFile(p, HARNESS_SOURCE, "utf8").then(
      () => p,
      (e) => {
        harnessPath = null;
        throw e;
      }
    );
  }
  return harnessPath;
}

/** A line the example runner treats as a Python assert example. */
export function isPythonAssertLine(line: string): boolean {
  return /^\s*assert\b/.test(line);
}

/**
 * True if a Python-localized LeetCode expected value (True/False/None) is a plain
 * JSON-like literal, so `assert call == <expected>` is valid Python.
 */
export function isSafePythonLiteral(expected: string): boolean {
  const jsonish = expected
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  try {
    JSON.parse(jsonish);
    return true;
  } catch {
    return false;
  }
}
