import * as fs from "fs";
import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";
import {
  FRAME_LIMIT,
  harnessPath,
  parseTrace,
  renderTraceTreeHtml,
  type RecursionOutcome,
} from "./RecursionVisualizer";

const JS_HARNESS = `

;(function __lcexIterHarness() {
  let __nextId = 1;
  let __ops = 0;
  let __truncated = false;
  let __currentExpandId = 0;
  const __seen = new Set();
  function __emit(obj) {
    process.stderr.write("__TRACE__" + JSON.stringify(obj) + "\\n");
  }
  function __pushOp(value, kind) {
    if (__ops++ >= ${FRAME_LIMIT}) {
      __truncated = true;
      throw new Error("__LCEX_TRACE_LIMIT__");
    }
    const id = __nextId++;
    let argsJson;
    try { argsJson = JSON.stringify([value]); } catch { argsJson = "(unserializable)"; }
    const memoHit = __seen.has(argsJson);
    __seen.add(argsJson);
    __emit({ e: "enter", id, parentId: __currentExpandId, fn: kind, args: argsJson, depth: 0, memoHit });
    return id;
  }
  function __popOp(id) {
    __currentExpandId = id;
    __emit({ e: "exit", id });
  }
  globalThis.lcexTrace = {
    track(container, kind) {
      if (!Array.isArray(container)) {
        process.stderr.write("__TRACE_ERR__lcexTrace.track expects an array (use [] or [seed])\\n");
        throw new Error("__LCEX_TRACE_ABORT__");
      }
      const knd = kind || "container";
      const ids = [];
      const seed = container.splice(0);
      const origPush = Array.prototype.push;
      const origPop = Array.prototype.pop;
      const origShift = Array.prototype.shift;
      const origUnshift = Array.prototype.unshift;
      for (const item of seed) {
        const id = __pushOp(item, knd);
        ids.push(id);
        origPush.call(container, item);
      }
      container.push = function (...items) {
        for (const item of items) {
          const id = __pushOp(item, knd);
          ids.push(id);
        }
        return origPush.apply(this, items);
      };
      container.pop = function () {
        const item = origPop.call(this);
        if (item !== undefined) {
          const id = ids.pop();
          if (id !== undefined) __popOp(id);
        }
        return item;
      };
      container.shift = function () {
        const item = origShift.call(this);
        if (item !== undefined) {
          const id = ids.shift();
          if (id !== undefined) __popOp(id);
        }
        return item;
      };
      container.unshift = function (...items) {
        const newIds = [];
        for (const item of items) {
          const id = __pushOp(item, knd);
          newIds.push(id);
        }
        ids.unshift(...newIds);
        return origUnshift.apply(this, items);
      };
      return container;
    },
  };
  try {
    if (typeof traceCall === "function") {
      traceCall();
    } else {
      process.stderr.write("__TRACE_ERR__define traceCall() that uses lcexTrace.track(container) and runs the loop\\n");
      return;
    }
    process.stderr.write("__TRACE_DONE__" + JSON.stringify({ frames: __ops, truncated: __truncated }) + "\\n");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg === "__LCEX_TRACE_LIMIT__") {
      process.stderr.write("__TRACE_DONE__" + JSON.stringify({ frames: __ops, truncated: true }) + "\\n");
    } else if (msg === "__LCEX_TRACE_ABORT__") {
      // err already emitted
    } else {
      process.stderr.write("__TRACE_ERR__" + msg + "\\n");
    }
  }
})();
`;

const PY_HARNESS = `

def __lcex_iter_harness():
    import sys, json, builtins
    next_id = [1]
    ops = [0]
    truncated = [False]
    current_expand = [0]
    seen = set()
    LIMIT = ${FRAME_LIMIT}

    def push_op(value, kind):
        if ops[0] >= LIMIT:
            truncated[0] = True
            raise RuntimeError("__LCEX_TRACE_LIMIT__")
        ops[0] += 1
        i = next_id[0]; next_id[0] += 1
        try:
            args_json = json.dumps([value], default=str)
        except Exception:
            args_json = "(unserializable)"
        memo_hit = args_json in seen
        seen.add(args_json)
        sys.stderr.write("__TRACE__" + json.dumps({"e": "enter", "id": i, "parentId": current_expand[0], "fn": kind, "args": args_json, "depth": 0, "memoHit": memo_hit}) + "\\n")
        return i

    def pop_op(i):
        current_expand[0] = i
        sys.stderr.write("__TRACE__" + json.dumps({"e": "exit", "id": i}) + "\\n")

    class Tracked(list):
        def __init__(self, items=(), kind="container"):
            super().__init__()
            self._kind = kind
            self._ids = []
            for it in items:
                i = push_op(it, kind)
                self._ids.append(i)
                list.append(self, it)
        def append(self, x):
            i = push_op(x, self._kind)
            self._ids.append(i)
            list.append(self, x)
        def pop(self, idx=-1):
            x = list.pop(self, idx)
            if self._ids:
                if idx == -1 or idx == len(self._ids):
                    i = self._ids.pop()
                else:
                    i = self._ids.pop(idx)
                pop_op(i)
            return x
        def appendleft(self, x):
            i = push_op(x, self._kind)
            self._ids.insert(0, i)
            list.insert(self, 0, x)
        def popleft(self):
            return self.pop(0)
        def insert(self, idx, x):
            i = push_op(x, self._kind)
            self._ids.insert(idx, i)
            list.insert(self, idx, x)
        def extend(self, items):
            for it in items:
                self.append(it)

    class _Trace:
        @staticmethod
        def track(container, kind="container"):
            return Tracked(container, kind)

    builtins.lcex_trace = _Trace()
    builtins.lcexTrace = _Trace()

    try:
        if "trace_call" in globals():
            globals()["trace_call"]()
        elif "traceCall" in globals():
            globals()["traceCall"]()
        else:
            sys.stderr.write("__TRACE_ERR__define trace_call() that uses lcex_trace.track(container) and runs the loop\\n")
            return
        sys.stderr.write("__TRACE_DONE__" + json.dumps({"frames": ops[0], "truncated": truncated[0]}) + "\\n")
    except RuntimeError as e:
        if "__LCEX_TRACE_LIMIT__" in str(e):
            sys.stderr.write("__TRACE_DONE__" + json.dumps({"frames": ops[0], "truncated": True}) + "\\n")
        else:
            sys.stderr.write(f"__TRACE_ERR__{e}\\n")
    except Exception as e:
        sys.stderr.write(f"__TRACE_ERR__{e}\\n")

__lcex_iter_harness()
`;

export interface IterativeRunOptions {
  source: string;
  lang: SupportedLanguage;
  slug: string;
}

export async function runIterativeTrace(opts: IterativeRunOptions): Promise<RecursionOutcome> {
  if (opts.lang === "cpp") {
    return { ok: false, frames: [], truncated: false, message: "iterative visualizer doesn't support C++ yet" };
  }
  if (opts.lang === "java") {
    return { ok: false, frames: [], truncated: false, message: "iterative visualizer doesn't support Java yet" };
  }
  const usesHelper = opts.lang === "python"
    ? /\blcex_trace\.track\s*\(|\blcexTrace\.track\s*\(/.test(opts.source)
    : /\blcexTrace\.track\s*\(/.test(opts.source);
  if (!usesHelper) {
    return {
      ok: false,
      frames: [],
      truncated: false,
      message:
        opts.lang === "python"
          ? "no `lcex_trace.track(container, \"stack\"|\"queue\")` call found — wrap your stack/queue and run the loop inside trace_call()"
          : "no `lcexTrace.track(container, \"stack\"|\"queue\")` call found — wrap your stack/queue and run the loop inside traceCall()",
    };
  }
  const strategy = getLanguageStrategy(opts.lang);
  const harness = opts.lang === "python" ? PY_HARNESS : JS_HARNESS;
  const filePath = harnessPath(opts.slug, strategy.fileExtension);
  fs.writeFileSync(filePath, opts.source + harness, "utf-8");
  try {
    const { stderr } = await strategy.runSolutionFile(filePath, path.dirname(filePath));
    const { frames, truncated, err } = parseTrace(stderr);
    if (err) return { ok: false, frames, truncated, message: `harness error: ${err}` };
    if (frames.length === 0) {
      return { ok: false, frames, truncated, message: "no operations captured (did the loop run?)" };
    }
    const kind = frames[0]?.fn || "container";
    return {
      ok: true,
      fn: kind,
      frames,
      truncated,
      message: `captured ${frames.length} ops${truncated ? ` (truncated at ${FRAME_LIMIT})` : ""}`,
    };
  } catch (e) {
    return {
      ok: false,
      frames: [],
      truncated: false,
      message: `run failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

export function renderIterativeTreeHtml(outcome: RecursionOutcome): string {
  return renderTraceTreeHtml(outcome, {
    icon: "🧭",
    titleSuffix: "traversal tree",
    failureTitle: "Iterative trace failed",
    memoLabel: "revisit",
    unitLabel: "op",
    showFn: false,
  });
}
