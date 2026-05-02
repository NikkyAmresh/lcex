import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SupportedLanguage } from "./interface/Problem";
import { getLanguageStrategy } from "./language/LanguageStrategy";

export interface FitMeasurement {
  n: number;
  ms: number;
}

export type ComplexityClass =
  | "O(1)"
  | "O(log n)"
  | "O(√n)"
  | "O(n)"
  | "O(n log n)"
  | "O(n²)"
  | "O(n³)"
  | "O(2ⁿ)";

export interface FitOutcome {
  ok: boolean;
  message: string;
  measurements: FitMeasurement[];
  bestFit?: ComplexityClass;
  bestRss?: number;
  ranking?: { cls: ComplexityClass; rss: number }[];
}

const HARNESS_DIR = path.join(os.homedir(), ".lcex", "fit");

function ensureDir(): void {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
}

function harnessPath(slug: string, ext: string): string {
  ensureDir();
  return path.join(HARNESS_DIR, `fit-${slug}-${Date.now().toString(36)}${ext}`);
}

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

export interface FitPreflight {
  ok: boolean;
  reason?: string;
}

export function preflight(src: string, lang: SupportedLanguage): FitPreflight {
  if (lang === "cpp") return { ok: false, reason: "complexity fitter doesn't support C++ yet" };
  const fns = lang === "python" ? findFunctionsPython(src) : findFunctionsJsLike(src);
  const has = fns.some((n) => n === "benchmark");
  if (!has) {
    return {
      ok: false,
      reason:
        lang === "python"
          ? "complexity fitter needs a `def benchmark(n)` function that runs your solution at problem size n"
          : "complexity fitter needs a `function benchmark(n)` that runs your solution at problem size n",
    };
  }
  return { ok: true };
}

const SIZES = [16, 64, 256, 1024, 4096, 16384];

const JS_HARNESS = (sizes: number[]) => `

;(function __lcexFitHarness() {
  try {
    const __sizes = ${JSON.stringify(sizes)};
    const __out = [];
    // warmup
    try { benchmark(__sizes[0]); } catch (_) {}
    for (const __n of __sizes) {
      const __reps = __n <= 64 ? 5 : __n <= 1024 ? 3 : 1;
      const __t0 = process.hrtime.bigint();
      for (let __r = 0; __r < __reps; __r++) benchmark(__n);
      const __t1 = process.hrtime.bigint();
      const __ms = Number(__t1 - __t0) / 1e6 / __reps;
      __out.push({ n: __n, ms: __ms });
      if (__ms > 4000) break;
    }
    process.stdout.write("__LCEX_FIT__" + JSON.stringify(__out) + "\\n");
  } catch (e) {
    process.stderr.write("__LCEX_FIT_ERR__" + (e && e.message ? e.message : String(e)) + "\\n");
  }
})();
`;

const PY_HARNESS = (sizes: number[]) => `

def __lcex_fit_harness():
    import json, sys, time
    sizes = ${JSON.stringify(sizes)}
    try:
        try:
            benchmark(sizes[0])
        except Exception:
            pass
        out = []
        for n in sizes:
            reps = 5 if n <= 64 else 3 if n <= 1024 else 1
            t0 = time.perf_counter_ns()
            for _ in range(reps):
                benchmark(n)
            t1 = time.perf_counter_ns()
            ms = (t1 - t0) / 1e6 / reps
            out.append({"n": n, "ms": ms})
            if ms > 4000:
                break
        sys.stdout.write("__LCEX_FIT__" + json.dumps(out) + "\\n")
    except Exception as e:
        sys.stderr.write(f"__LCEX_FIT_ERR__{e}\\n")

__lcex_fit_harness()
`;

const SAFE_LOG = (x: number) => Math.log(Math.max(x, 1e-9));

const MODELS: { cls: ComplexityClass; x: (n: number) => number }[] = [
  { cls: "O(1)", x: (_n) => 0 },
  { cls: "O(log n)", x: (n) => SAFE_LOG(SAFE_LOG(n + 1) + 1) },
  { cls: "O(√n)", x: (n) => 0.5 * SAFE_LOG(n) },
  { cls: "O(n)", x: (n) => SAFE_LOG(n) },
  { cls: "O(n log n)", x: (n) => SAFE_LOG(n) + SAFE_LOG(SAFE_LOG(n + 1) + 1) },
  { cls: "O(n²)", x: (n) => 2 * SAFE_LOG(n) },
  { cls: "O(n³)", x: (n) => 3 * SAFE_LOG(n) },
  { cls: "O(2ⁿ)", x: (n) => n * SAFE_LOG(2) },
];

export function fitCurve(measurements: FitMeasurement[]): { best: ComplexityClass; rss: number; ranking: { cls: ComplexityClass; rss: number }[] } | null {
  const usable = measurements.filter((m) => m.ms > 0 && m.n > 0);
  if (usable.length < 3) return null;
  const ys = usable.map((m) => SAFE_LOG(m.ms));
  const ranking: { cls: ComplexityClass; rss: number }[] = [];
  for (const model of MODELS) {
    const xs = usable.map((m) => model.x(m.n));
    const offsets = ys.map((y, i) => y - xs[i]);
    const c = offsets.reduce((s, v) => s + v, 0) / offsets.length;
    let rss = 0;
    for (let i = 0; i < ys.length; i++) {
      const pred = c + xs[i];
      const r = ys[i] - pred;
      rss += r * r;
    }
    ranking.push({ cls: model.cls, rss });
  }
  ranking.sort((a, b) => a.rss - b.rss);
  return { best: ranking[0].cls, rss: ranking[0].rss, ranking };
}

function parseOutcome(stdout: string, stderr: string): { measurements: FitMeasurement[]; err?: string } {
  const errMatch = /__LCEX_FIT_ERR__(.+)/m.exec(stderr) || /__LCEX_FIT_ERR__(.+)/m.exec(stdout);
  if (errMatch) return { measurements: [], err: errMatch[1].trim() };
  const m = /__LCEX_FIT__(\[.*\])\s*$/m.exec(stdout);
  if (!m) return { measurements: [], err: `no fit marker (stderr: ${stderr.trim().slice(0, 200)})` };
  try {
    const arr = JSON.parse(m[1]) as FitMeasurement[];
    if (!Array.isArray(arr)) return { measurements: [], err: "fit marker did not parse to an array" };
    return { measurements: arr };
  } catch (e) {
    return { measurements: [], err: `failed to parse fit output: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface FitRunOptions {
  source: string;
  lang: SupportedLanguage;
  slug: string;
  sizes?: number[];
}

export async function runEmpiricalFit(opts: FitRunOptions): Promise<FitOutcome> {
  const pf = preflight(opts.source, opts.lang);
  if (!pf.ok) return { ok: false, message: pf.reason ?? "preflight failed", measurements: [] };
  const sizes = opts.sizes ?? SIZES;
  const strategy = getLanguageStrategy(opts.lang);
  const harness = opts.lang === "python" ? PY_HARNESS(sizes) : JS_HARNESS(sizes);
  const filePath = harnessPath(opts.slug, strategy.fileExtension);
  fs.writeFileSync(filePath, opts.source + harness, "utf-8");
  try {
    const { stdout, stderr } = await strategy.runSolutionFile(filePath, path.dirname(filePath));
    const { measurements, err } = parseOutcome(stdout, stderr);
    if (err) return { ok: false, message: `harness error: ${err}`, measurements };
    if (measurements.length < 3) {
      return {
        ok: false,
        message: `not enough measurements (${measurements.length}) — try a larger benchmark or simpler operation`,
        measurements,
      };
    }
    const fit = fitCurve(measurements);
    if (!fit) return { ok: false, message: "could not fit curve (timings too noisy)", measurements };
    const tail = measurements
      .map((m) => `n=${m.n}: ${m.ms.toFixed(2)}ms`)
      .join("  ·  ");
    return {
      ok: true,
      message: `best fit ${fit.best} · ${tail}`,
      measurements,
      bestFit: fit.best,
      bestRss: fit.rss,
      ranking: fit.ranking,
    };
  } catch (e) {
    return { ok: false, message: `run failed: ${e instanceof Error ? e.message : String(e)}`, measurements: [] };
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}
