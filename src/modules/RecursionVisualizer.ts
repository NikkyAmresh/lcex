import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

export interface TraceFrame {
  id: number;
  parentId: number | null;
  fn: string;
  args: string;
  ret?: string;
  depth: number;
  memoHit: boolean;
  durationMs?: number;
}

export interface RecursionOutcome {
  ok: boolean;
  message: string;
  fn?: string;
  frames: TraceFrame[];
  truncated: boolean;
}

const HARNESS_DIR = path.join(os.homedir(), ".lcex", "trace");
export const FRAME_LIMIT = 5000;

function ensureDir(): void {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
}

export function harnessPath(slug: string, ext: string): string {
  ensureDir();
  return path.join(HARNESS_DIR, `trace-${slug}-${Date.now().toString(36)}${ext}`);
}

const RESERVED = new Set(["bruteForce", "brute_force", "fuzzInputs", "fuzz_inputs", "benchmark", "main", "console"]);

/** Find a recursive function: any top-level function whose body references its own name. */
function detectRecursiveFnJsLike(src: string): string | undefined {
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, name, , body] = m;
    if (RESERVED.has(name)) continue;
    const selfRef = new RegExp(`\\b${name}\\s*\\(`).test(body);
    if (selfRef) return name;
  }
  return undefined;
}

function detectRecursiveFnPython(src: string): string | undefined {
  const re = /^\s*def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\):\s*\n((?:\s+[^\n]*\n?)+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, name, , body] = m;
    if (RESERVED.has(name)) continue;
    const selfRef = new RegExp(`\\b${name}\\s*\\(`).test(body);
    if (selfRef) return name;
  }
  return undefined;
}

const JS_HARNESS = (fn: string) => `

;(function __lcexTraceHarness() {
  const __FN = "${fn}";
  if (typeof ${fn} !== "function") {
    process.stderr.write("__TRACE_ERR__not a function: " + __FN + "\\n");
    return;
  }
  const __orig = ${fn};
  let __nextId = 1;
  let __frames = 0;
  let __truncated = false;
  const __stack = [{ id: 0 }];
  const __seen = new Set();
  ${fn} = function __traced_${fn}(...args) {
    if (__frames++ >= ${FRAME_LIMIT}) {
      __truncated = true;
      throw new Error("__LCEX_TRACE_LIMIT__");
    }
    const id = __nextId++;
    let argsJson;
    try { argsJson = JSON.stringify(args); } catch { argsJson = "(unserializable)"; }
    const memoHit = __seen.has(argsJson);
    __seen.add(argsJson);
    const parent = __stack[__stack.length - 1];
    const depth = __stack.length - 1;
    process.stderr.write("__TRACE__" + JSON.stringify({ e: "enter", id, parentId: parent.id, fn: __FN, args: argsJson, depth, memoHit }) + "\\n");
    __stack.push({ id });
    const t0 = process.hrtime.bigint();
    try {
      const ret = __orig.apply(this, args);
      const t1 = process.hrtime.bigint();
      let retJson;
      try { retJson = JSON.stringify(ret); } catch { retJson = "(unserializable)"; }
      process.stderr.write("__TRACE__" + JSON.stringify({ e: "exit", id, ret: retJson, durationMs: Number(t1 - t0) / 1e6 }) + "\\n");
      return ret;
    } finally {
      __stack.pop();
    }
  };
  // Best-effort: invoke a main call. Convention: define traceCall to drive the recursion.
  try {
    if (typeof traceCall === "function") {
      traceCall();
    } else {
      process.stderr.write("__TRACE_ERR__define traceCall() that invokes ${fn}(...) once\\n");
      return;
    }
    process.stderr.write("__TRACE_DONE__" + JSON.stringify({ frames: __frames, truncated: __truncated }) + "\\n");
  } catch (e) {
    if (String(e && e.message) === "__LCEX_TRACE_LIMIT__") {
      process.stderr.write("__TRACE_DONE__" + JSON.stringify({ frames: __frames, truncated: true }) + "\\n");
    } else {
      process.stderr.write("__TRACE_ERR__" + (e && e.message ? e.message : String(e)) + "\\n");
    }
  }
})();
`;

const PY_HARNESS = (fn: string) => `

def __lcex_trace_harness():
    import sys, json, time
    target = "${fn}"
    fn = globals().get(target)
    if not callable(fn):
        sys.stderr.write(f"__TRACE_ERR__not callable: {target}\\n")
        return
    next_id = [1]
    frames = [0]
    truncated = [False]
    stack = [{"id": 0}]
    seen = set()
    LIMIT = ${FRAME_LIMIT}
    starts = {}
    def traced(*args, **kwargs):
        if frames[0] >= LIMIT:
            truncated[0] = True
            raise RuntimeError("__LCEX_TRACE_LIMIT__")
        frames[0] += 1
        i = next_id[0]; next_id[0] += 1
        try:
            args_json = json.dumps(list(args), default=str)
        except Exception:
            args_json = "(unserializable)"
        memo_hit = args_json in seen
        seen.add(args_json)
        parent = stack[-1]
        depth = len(stack) - 1
        sys.stderr.write("__TRACE__" + json.dumps({"e": "enter", "id": i, "parentId": parent["id"], "fn": target, "args": args_json, "depth": depth, "memoHit": memo_hit}) + "\\n")
        stack.append({"id": i})
        t0 = time.perf_counter_ns()
        try:
            ret = fn(*args, **kwargs)
            try:
                ret_json = json.dumps(ret, default=str)
            except Exception:
                ret_json = "(unserializable)"
            sys.stderr.write("__TRACE__" + json.dumps({"e": "exit", "id": i, "ret": ret_json, "durationMs": (time.perf_counter_ns() - t0) / 1e6}) + "\\n")
            return ret
        finally:
            stack.pop()
    globals()[target] = traced
    try:
        if "trace_call" in globals():
            globals()["trace_call"]()
        elif "traceCall" in globals():
            globals()["traceCall"]()
        else:
            sys.stderr.write(f"__TRACE_ERR__define trace_call() that invokes {target}(...) once\\n")
            return
        sys.stderr.write("__TRACE_DONE__" + json.dumps({"frames": frames[0], "truncated": truncated[0]}) + "\\n")
    except RuntimeError as e:
        if "__LCEX_TRACE_LIMIT__" in str(e):
            sys.stderr.write("__TRACE_DONE__" + json.dumps({"frames": frames[0], "truncated": True}) + "\\n")
        else:
            sys.stderr.write(f"__TRACE_ERR__{e}\\n")
    except Exception as e:
        sys.stderr.write(f"__TRACE_ERR__{e}\\n")

__lcex_trace_harness()
`;

export function parseTrace(stderr: string): { frames: TraceFrame[]; truncated: boolean; err?: string } {
  const errMatch = /__TRACE_ERR__(.+)/m.exec(stderr);
  if (errMatch) return { frames: [], truncated: false, err: errMatch[1].trim() };
  const enterEvents = new Map<number, { parentId: number; fn: string; args: string; depth: number; memoHit: boolean }>();
  const exits = new Map<number, { ret?: string; durationMs?: number }>();
  const lines = stderr.split("\n").filter((l) => l.startsWith("__TRACE__"));
  for (const l of lines) {
    try {
      const obj = JSON.parse(l.slice("__TRACE__".length));
      if (obj.e === "enter") {
        enterEvents.set(obj.id, {
          parentId: obj.parentId,
          fn: obj.fn,
          args: obj.args,
          depth: obj.depth,
          memoHit: !!obj.memoHit,
        });
      } else if (obj.e === "exit") {
        exits.set(obj.id, { ret: obj.ret, durationMs: obj.durationMs });
      }
    } catch {
      /* skip malformed line */
    }
  }
  const doneMatch = /__TRACE_DONE__(\{.*\})\s*$/m.exec(stderr);
  let truncated = false;
  if (doneMatch) {
    try {
      const d = JSON.parse(doneMatch[1]);
      truncated = !!d.truncated;
    } catch { /* ignore */ }
  }
  const frames: TraceFrame[] = [];
  for (const [id, ev] of enterEvents) {
    const exit = exits.get(id);
    frames.push({
      id,
      parentId: ev.parentId === 0 ? null : ev.parentId,
      fn: ev.fn,
      args: ev.args,
      depth: ev.depth,
      memoHit: ev.memoHit,
      ret: exit?.ret,
      durationMs: exit?.durationMs,
    });
  }
  frames.sort((a, b) => a.id - b.id);
  return { frames, truncated };
}

export interface TraceRunOptions {
  source: string;
  lang: SupportedLanguage;
  slug: string;
}

export async function runRecursionTrace(opts: TraceRunOptions): Promise<RecursionOutcome> {
  if (opts.lang === "cpp") {
    return { ok: false, frames: [], truncated: false, message: "recursion visualizer doesn't support C++ yet" };
  }
  const fn = opts.lang === "python" ? detectRecursiveFnPython(opts.source) : detectRecursiveFnJsLike(opts.source);
  if (!fn) {
    return { ok: false, frames: [], truncated: false, message: "no recursive top-level function detected (a function whose body calls itself)" };
  }
  const strategy = getLanguageStrategy(opts.lang);
  const harness = opts.lang === "python" ? PY_HARNESS(fn) : JS_HARNESS(fn);
  const filePath = harnessPath(opts.slug, strategy.fileExtension);
  fs.writeFileSync(filePath, opts.source + harness, "utf-8");
  try {
    const { stderr } = await strategy.runSolutionFile(filePath, path.dirname(filePath));
    const { frames, truncated, err } = parseTrace(stderr);
    if (err) return { ok: false, fn, frames, truncated, message: `harness error: ${err}` };
    if (frames.length === 0) {
      return { ok: false, fn, frames, truncated, message: "no trace frames captured (did traceCall() run the recursion?)" };
    }
    return {
      ok: true,
      fn,
      frames,
      truncated,
      message: `captured ${frames.length} frames${truncated ? ` (truncated at ${FRAME_LIMIT})` : ""}`,
    };
  } catch (e) {
    return {
      ok: false,
      fn,
      frames: [],
      truncated: false,
      message: `run failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

export interface TraceTreeRenderOptions {
  icon?: string;
  titleSuffix?: string;
  failureTitle?: string;
  memoLabel?: string;
  unitLabel?: string;
  showFn?: boolean;
}

/** Render an HTML tree (no external deps; uses <details>/<summary> + inline styles). */
export function renderTraceTreeHtml(outcome: RecursionOutcome, opts: TraceTreeRenderOptions = {}): string {
  const icon = opts.icon ?? "🌳";
  const titleSuffix = opts.titleSuffix ?? "call tree";
  const failureTitle = opts.failureTitle ?? "Recursion trace failed";
  const memoLabel = opts.memoLabel ?? "memo-hit";
  const unitLabel = opts.unitLabel ?? "frame";
  const showFn = opts.showFn ?? true;
  if (!outcome.ok) {
    return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#888">
      <h2>${escapeHtml(failureTitle)}</h2><pre>${escapeHtml(outcome.message)}</pre></body></html>`;
  }
  const childrenOf = new Map<number | null, TraceFrame[]>();
  for (const f of outcome.frames) {
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f);
    childrenOf.set(f.parentId, arr);
  }
  const memoHits = outcome.frames.filter((f) => f.memoHit).length;
  const renderNode = (f: TraceFrame): string => {
    const kids = childrenOf.get(f.id) ?? [];
    const ret = f.ret !== undefined ? ` → <span style="color:#7ec47e">${escapeHtml(f.ret)}</span>` : "";
    const memoBadge = f.memoHit
      ? ` <span style="background:#553;color:#ffeb3b;padding:0 4px;border-radius:3px;font-size:11px">${escapeHtml(memoLabel)}</span>`
      : "";
    const dur = f.durationMs !== undefined ? ` <span style="color:#888;font-size:11px">${f.durationMs.toFixed(2)}ms</span>` : "";
    const argInner = escapeHtml(f.args.replace(/^\[|\]$/g, ""));
    const label = showFn
      ? `<code>${escapeHtml(f.fn)}(${argInner})</code>${ret}${memoBadge}${dur}`
      : `<code>${argInner}</code>${ret}${memoBadge}${dur}`;
    if (kids.length === 0) return `<div style="padding:2px 0 2px 1.5em">${label}</div>`;
    return `<details open><summary style="cursor:pointer;padding:2px 0">${label}</summary><div style="border-left:1px dashed #555;margin-left:0.5em;padding-left:1em">${kids.map(renderNode).join("")}</div></details>`;
  };
  const roots = childrenOf.get(null) ?? [];
  const headline = `${icon} ${escapeHtml(outcome.fn ?? "")} ${titleSuffix}`.replace(/\s+/g, " ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>lcex trace</title>
    <style>body{font-family:ui-monospace,Menlo,monospace;background:#1e1e1e;color:#d4d4d4;padding:1.5rem;margin:0}
    h2{color:#9cdcfe;margin:0 0 0.25em 0}
    .meta{color:#888;font-size:12px;margin-bottom:1.5em}
    summary::marker{color:#888}
    code{color:#d4d4d4}</style></head><body>
    <h2>${headline}</h2>
    <div class="meta">${outcome.frames.length} ${unitLabel}${outcome.frames.length === 1 ? "" : "s"} · ${memoHits} ${memoLabel}${memoHits === 1 ? "" : "s"}${outcome.truncated ? ` · <span style="color:#f48771">truncated at ${FRAME_LIMIT}</span>` : ""}</div>
    ${roots.map(renderNode).join("")}
  </body></html>`;
}

/** Backwards-compatible alias used by the recursion command. */
export function renderRecursionTreeHtml(outcome: RecursionOutcome): string {
  return renderTraceTreeHtml(outcome, { icon: "🌳", titleSuffix: "call tree", failureTitle: "Recursion trace failed" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
