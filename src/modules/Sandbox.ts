import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

export type SandboxMode = "auto" | "sandbox" | "off";

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface SandboxRunOpts {
  cwd: string;
  timeout: number;
  /** Absolute paths the sandboxed process is allowed to write to. */
  writePaths?: string[];
}

function readSandboxMode(): SandboxMode {
  try {
    // Lazy require so this module stays importable in non-vscode contexts.
    const vscode = require("vscode") as typeof import("vscode");
    const v = vscode.workspace
      .getConfiguration("leetcodePractice")
      .get<string>("runExamples.sandbox");
    if (v === "off" || v === "sandbox" || v === "auto") return v;
  } catch {
    // not in vscode context
  }
  return "auto";
}

export function isSandboxActive(mode: SandboxMode = readSandboxMode()): boolean {
  if (mode === "off") return false;
  if (mode === "sandbox") return true;
  return process.platform === "darwin";
}

function execWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<SandboxRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, { cwd });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeout);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || (e?.message ?? String(e)),
        exitCode: null,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut
          ? `${stderr}\nlcex: process killed after ${timeout}ms timeout`.trimStart()
          : stderr,
        exitCode: timedOut ? null : code,
      });
    });
  });
}

function escapeSbplString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildMacProfile(writePaths: string[]): string {
  const home = os.homedir();
  const defaultWriteSubpaths = [
    "/private/tmp",
    "/private/var/tmp",
    "/private/var/folders",
    path.join(home, ".npm"),
    path.join(home, ".cache"),
  ];
  const defaultWriteLiterals = ["/dev/null", "/dev/dtracehelper", "/dev/tty"];

  const seen = new Set<string>();
  const subpaths = [...defaultWriteSubpaths, ...writePaths]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p && !seen.has(p) && (seen.add(p), true));

  const subpathRules = subpaths
    .map((p) => `(allow file-write* (subpath "${escapeSbplString(p)}"))`)
    .join("\n");
  const literalRules = defaultWriteLiterals
    .map((p) => `(allow file-write* (literal "${escapeSbplString(p)}"))`)
    .join("\n");

  // Allow-default with two narrow denies: network and writes outside the
  // declared scratch/cache paths. This protects against exfiltration and
  // arbitrary filesystem modification while keeping toolchain syscalls
  // (process spawning, dyld, mach lookups) working without per-syscall
  // allowlisting.
  return `(version 1)
(allow default)
(deny network*)
(allow network* (local ip) (remote ip "localhost:*"))
(deny file-write*)
${literalRules}
${subpathRules}
`;
}

const SANDBOX_HINT =
  'lcex: this may be blocked by the sandbox. Set `leetcodePractice.runExamples.sandbox` to "off" to disable.';

// Tell-tale fragments from kernel/runtime errors when the sandbox denies a
// file-write or network syscall. Matched case-insensitively against combined
// stdout+stderr so the hint also fires when a child process (e.g. node) prints
// the error code through stdout instead of stderr.
const SANDBOX_ERROR_PATTERNS = [
  "EPERM",
  "Operation not permitted",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "deny file-write",
  "deny network",
];

function maybeAppendSandboxHint(result: SandboxRunResult): SandboxRunResult {
  if (result.exitCode === 0) return result;
  const haystack = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const hit = SANDBOX_ERROR_PATTERNS.some((p) => haystack.includes(p.toLowerCase()));
  if (!hit) return result;
  const stderr = result.stderr.includes(SANDBOX_HINT)
    ? result.stderr
    : `${result.stderr.replace(/\s+$/, "")}\n${SANDBOX_HINT}`.trimStart();
  return { ...result, stderr };
}

export async function runSandboxed(
  cmdLine: string,
  opts: SandboxRunOpts
): Promise<SandboxRunResult> {
  const mode = readSandboxMode();
  const active = isSandboxActive(mode);

  if (!active) {
    return execWithTimeout("/bin/sh", ["-c", cmdLine], opts.cwd, opts.timeout);
  }

  if (process.platform !== "darwin") {
    return {
      stdout: "",
      stderr:
        "lcex: leetcodePractice.runExamples.sandbox is set to 'sandbox' but no sandbox backend is available on this platform. Set it to 'auto' or 'off'.",
      exitCode: null,
    };
  }

  const profile = buildMacProfile(opts.writePaths ?? []);
  const profilePath = path.join(
    os.tmpdir(),
    `lcex-sandbox-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sb`
  );
  await fs.writeFile(profilePath, profile, "utf8");
  try {
    const result = await execWithTimeout(
      "/usr/bin/sandbox-exec",
      ["-f", profilePath, "/bin/sh", "-c", cmdLine],
      opts.cwd,
      opts.timeout
    );
    return maybeAppendSandboxHint(result);
  } finally {
    fs.unlink(profilePath).catch(() => {});
  }
}
