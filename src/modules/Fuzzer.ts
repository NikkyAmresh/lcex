import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

export interface FuzzCounterexample {
  iter: number;
  argsJson: string;
  userOut: string;
  bruteOut: string;
}

export interface FuzzOutcome {
  ok: boolean;
  message: string;
  counterexample?: FuzzCounterexample;
  ranCases: number;
}

const HARNESS_DIR = path.join(os.homedir(), ".lcex", "fuzz");

function ensureHarnessDir(): void {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
}

function uniqHarnessPath(slug: string, ext: string): string {
  ensureHarnessDir();
  const stamp = Date.now().toString(36);
  return path.join(HARNESS_DIR, `fuzz-${slug}-${stamp}${ext}`);
}

/** Inspect source for the conventions the fuzzer requires. */
export interface FuzzPreflight {
  ok: boolean;
  reason?: string;
  solutionFn?: string;
}

const RESERVED = new Set(["bruteForce", "brute_force", "fuzzInputs", "fuzz_inputs"]);

function findFunctionsJsLike(src: string): string[] {
  const out: string[] = [];
  const re = /\b(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*)?\(?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function findFunctionsPython(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

export function preflight(src: string, lang: SupportedLanguage): FuzzPreflight {
  if (lang === "cpp") return { ok: false, reason: "C++ fuzzer not supported in v1." };
  const fns = lang === "python" ? findFunctionsPython(src) : findFunctionsJsLike(src);
  const hasBrute = fns.some((n) => n === "bruteForce" || n === "brute_force");
  const hasFuzzInputs = fns.some((n) => n === "fuzzInputs" || n === "fuzz_inputs");
  if (!hasBrute) {
    return {
      ok: false,
      reason:
        lang === "python"
          ? "fuzzer needs a `def brute_force(...)` (or `def bruteForce(...)`) function alongside your solution"
          : "fuzzer needs a `function bruteForce(...)` alongside your solution",
    };
  }
  if (!hasFuzzInputs) {
    return {
      ok: false,
      reason:
        lang === "python"
          ? "fuzzer needs a `def fuzz_inputs(seed)` returning a list of arg-tuples"
          : "fuzzer needs a `function fuzzInputs(seed)` returning an array of arg-tuples",
    };
  }
  const solutionFn = fns.find((n) => !RESERVED.has(n));
  if (!solutionFn) {
    return { ok: false, reason: "fuzzer could not detect your solution function (must be a top-level function declaration)" };
  }
  return { ok: true, solutionFn };
}

const JS_HARNESS = (solnFn: string, seed: number) => `

;(function __lcexFuzzHarness() {
  try {
    const __cases = (typeof fuzzInputs === "function") ? fuzzInputs(${seed}) : [];
    let __ran = 0;
    for (let __i = 0; __i < __cases.length; __i++) {
      const __args = __cases[__i];
      const __cloneA = JSON.parse(JSON.stringify(__args));
      const __cloneB = JSON.parse(JSON.stringify(__args));
      let __a, __b, __err;
      try { __a = JSON.stringify(${solnFn}.apply(null, __cloneA)); }
      catch (e) { __err = "user-threw: " + (e && e.message ? e.message : String(e)); }
      try { __b = JSON.stringify(bruteForce.apply(null, __cloneB)); }
      catch (e) { if (!__err) __err = "brute-threw: " + (e && e.message ? e.message : String(e)); }
      __ran++;
      if (__err) {
        process.stdout.write("__LCEX_FUZZ__" + JSON.stringify({ iter: __i, argsJson: JSON.stringify(__args), userOut: __a || __err, bruteOut: __b || __err, ranCases: __ran }) + "\\n");
        return;
      }
      if (__a !== __b) {
        process.stdout.write("__LCEX_FUZZ__" + JSON.stringify({ iter: __i, argsJson: JSON.stringify(__args), userOut: __a, bruteOut: __b, ranCases: __ran }) + "\\n");
        return;
      }
    }
    process.stdout.write("__LCEX_FUZZ_OK__" + __ran + "\\n");
  } catch (e) {
    process.stderr.write("__LCEX_FUZZ_ERR__" + (e && e.message ? e.message : String(e)) + "\\n");
  }
})();
`;

const PY_HARNESS = (solnFn: string, seed: number) => `

def __lcex_fuzz_harness():
    import json, sys, copy
    try:
        cases = fuzz_inputs(${seed}) if 'fuzz_inputs' in globals() else (fuzzInputs(${seed}) if 'fuzzInputs' in globals() else [])
        ran = 0
        brute = brute_force if 'brute_force' in globals() else bruteForce
        soln = ${solnFn}
        for i, args in enumerate(cases):
            err = None
            try:
                a = json.dumps(soln(*copy.deepcopy(list(args))), sort_keys=True, default=str)
            except Exception as e:
                err = f"user-threw: {e}"
                a = err
            try:
                b = json.dumps(brute(*copy.deepcopy(list(args))), sort_keys=True, default=str)
            except Exception as e:
                if not err:
                    err = f"brute-threw: {e}"
                b = err
            ran += 1
            if err or a != b:
                sys.stdout.write("__LCEX_FUZZ__" + json.dumps({"iter": i, "argsJson": json.dumps(list(args), default=str), "userOut": a, "bruteOut": b, "ranCases": ran}) + "\\n")
                return
        sys.stdout.write(f"__LCEX_FUZZ_OK__{ran}\\n")
    except Exception as e:
        sys.stderr.write(f"__LCEX_FUZZ_ERR__{e}\\n")

__lcex_fuzz_harness()
`;

function buildHarness(src: string, lang: SupportedLanguage, solnFn: string, seed: number): string {
  if (lang === "python") return src + PY_HARNESS(solnFn, seed);
  return src + JS_HARNESS(solnFn, seed);
}

function parseOutcome(stdout: string, stderr: string): FuzzOutcome {
  const errMatch = /__LCEX_FUZZ_ERR__(.+)/m.exec(stderr) || /__LCEX_FUZZ_ERR__(.+)/m.exec(stdout);
  if (errMatch) {
    return { ok: false, ranCases: 0, message: `harness error: ${errMatch[1].trim()}` };
  }
  const okMatch = /__LCEX_FUZZ_OK__(\d+)/m.exec(stdout);
  if (okMatch) {
    return { ok: true, ranCases: parseInt(okMatch[1], 10), message: `passed ${okMatch[1]} cases` };
  }
  const divergeMatch = /__LCEX_FUZZ__(\{.*\})/m.exec(stdout);
  if (divergeMatch) {
    try {
      const parsed = JSON.parse(divergeMatch[1]) as FuzzCounterexample & { ranCases?: number };
      return {
        ok: false,
        ranCases: parsed.ranCases ?? 0,
        message: `counterexample at iter ${parsed.iter}: user=${parsed.userOut} · brute=${parsed.bruteOut}`,
        counterexample: parsed,
      };
    } catch {
      /* fallthrough */
    }
  }
  return { ok: false, ranCases: 0, message: `no harness marker in output (stderr: ${stderr.trim().slice(0, 200)})` };
}

export interface FuzzRunOptions {
  source: string;
  lang: SupportedLanguage;
  slug: string;
  seed?: number;
}

export async function runFuzz(opts: FuzzRunOptions): Promise<FuzzOutcome> {
  const pf = preflight(opts.source, opts.lang);
  if (!pf.ok) return { ok: false, ranCases: 0, message: pf.reason ?? "preflight failed" };
  const seed = opts.seed ?? 42;
  const strategy = getLanguageStrategy(opts.lang);
  const harnessPath = uniqHarnessPath(opts.slug, strategy.fileExtension);
  const harness = buildHarness(opts.source, opts.lang, pf.solutionFn!, seed);
  fs.writeFileSync(harnessPath, harness, "utf-8");
  try {
    const { stdout, stderr } = await strategy.runSolutionFile(harnessPath, path.dirname(harnessPath));
    return parseOutcome(stdout, stderr);
  } catch (e) {
    return { ok: false, ranCases: 0, message: `run failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    try { fs.unlinkSync(harnessPath); } catch { /* ignore */ }
  }
}
