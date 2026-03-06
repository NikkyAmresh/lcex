import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type SolutionFileLang = "typescript" | "javascript" | "python";

export interface ProfilerResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  profilePath?: string;
}

export interface ExampleResult {
  lineIndex: number;
  pass: boolean;
  expected: string | null;
  actual: string;
}

function langFromExt(ext: string): SolutionFileLang {
  if (ext === ".py") return "python";
  if (ext === ".js") return "javascript";
  return "typescript";
}

export function parseExampleBlocks(
  content: string,
  lang: SolutionFileLang = "typescript"
): { callLine: number; expected: string | null }[] {
  const results: { callLine: number; expected: string | null }[] = [];
  const lines = content.split("\n");
  const isOutputLine =
    lang === "python"
      ? (line: string) => /print\s*\(/.test(line)
      : (line: string) => /console\.log\s*\(/.test(line);
  const commentRegex = lang === "python" ? /#\s*(.+)$/ : /\/\/\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isOutputLine(line)) continue;
    const commentMatch = line.match(commentRegex);
    results.push({ callLine: i + 1, expected: commentMatch ? commentMatch[1].trim() : null });
  }
  return results;
}

export async function runSolutionFile(
  filePath: string,
  lang?: SolutionFileLang
): Promise<{ stdout: string; stderr: string }> {
  const ext = path.extname(filePath);
  const resolvedLang = lang ?? langFromExt(ext);
  const dir = path.dirname(filePath);
  const normalized = path.normalize(filePath);
  const cmd =
    resolvedLang === "python"
      ? `python3 "${normalized}"`
      : resolvedLang === "javascript"
        ? `node "${normalized}"`
        : `npx --yes tsx "${normalized}"`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: dir,
      timeout: 15000,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

export interface RunWithProfilingOptions {
  filePath: string;
  lang?: SolutionFileLang;
  outputChannel?: { append: (s: string) => void; appendLine: (s: string) => void };
  enableCpuProfile?: boolean;
}

/** Runs solution with realtime output streaming, timing, and optional CPU profiling (Node/TS). */
export async function runSolutionFileWithProfiling(
  opts: RunWithProfilingOptions
): Promise<ProfilerResult> {
  const { filePath, outputChannel, enableCpuProfile = false } = opts;
  const ext = path.extname(filePath);
  const lang = opts.lang ?? langFromExt(ext);
  const dir = path.dirname(filePath);
  const normalized = path.normalize(filePath);
  const append = (s: string) => outputChannel?.append(s);
  const appendLine = (s: string) => outputChannel?.appendLine(s);

  const isNode = lang === "typescript" || lang === "javascript";
  const useCpuProfile = enableCpuProfile && isNode;
  const profileDir = useCpuProfile ? path.join(os.tmpdir(), `lcex-profile-${Date.now()}`) : undefined;
  if (useCpuProfile && profileDir) fs.mkdirSync(profileDir, { recursive: true });

  let executable: string;
  let args: string[];
  const env = { ...process.env };
  if (lang === "python") {
    executable = "python3";
    args = [normalized];
  } else if (lang === "javascript") {
    executable = "node";
    args = [normalized];
    if (useCpuProfile && profileDir) {
      env.NODE_OPTIONS = `--cpu-prof --cpu-prof-dir=${profileDir}`;
    }
  } else {
    executable = "npx";
    args = ["--yes", "tsx", normalized];
    if (useCpuProfile && profileDir) {
      env.NODE_OPTIONS = `--cpu-prof --cpu-prof-dir=${profileDir}`;
    }
  }

  const start = performance.now();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd: dir,
      env,
      shell: false,
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Execution timed out after 15s"));
    }, 15000);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdoutChunks.push(s);
      append(s);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderrChunks.push(s);
      append(s);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      const durationMs = Math.round(performance.now() - start);
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      appendLine(`--- Completed in ${durationMs}ms (exit ${code ?? "?"}) ---`);

      if (useCpuProfile && profileDir && fs.existsSync(profileDir)) {
        const logs = fs.readdirSync(profileDir).filter((f) => f.endsWith("-v8.log"));
        const logPath = logs.length > 0 ? path.join(profileDir, logs[0]) : undefined;
        if (logPath) {
          try {
            const summary = execSync(`node --prof-process "${logPath}"`, {
              encoding: "utf-8",
              maxBuffer: 1024 * 1024,
            });
            appendLine("--- CPU Profile (top ticks) ---");
            const lines = summary.split("\n").slice(0, 35);
            appendLine(lines.join("\n"));
            appendLine(`Full profile: node --prof-process "${logPath}"`);
          } catch {
            appendLine(`CPU profile saved to ${logPath}`);
          }
        }
        try {
          fs.rmSync(profileDir, { recursive: true });
        } catch {
          /* ignore */
        }
      }

      resolve({
        stdout,
        stderr,
        durationMs,
        profilePath: useCpuProfile && profileDir ? profileDir : undefined,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** @deprecated Use runSolutionFile */
export async function runTsFile(filePath: string): Promise<{ stdout: string; stderr: string }> {
  return runSolutionFile(filePath, "typescript");
}

function parseStdoutLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeExpected(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function normalizeActual(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function compareOutput(
  content: string,
  stdout: string,
  lang: SolutionFileLang = "typescript"
): ExampleResult[] {
  const blocks = parseExampleBlocks(content, lang);
  const actualLines = parseStdoutLines(stdout);
  return blocks.map((block, index) => {
    const actual = actualLines[index] ?? "";
    const expected = block.expected;
    const pass =
      expected === null ? true : normalizeExpected(expected) === normalizeActual(actual);
    return { lineIndex: block.callLine, pass, expected, actual };
  });
}

export interface RunExamplesOptions {
  useProfiler?: boolean;
  outputChannel?: { append: (s: string) => void; appendLine: (s: string) => void };
  enableCpuProfile?: boolean;
}

export async function runExamples(
  uri: { fsPath: string },
  opts?: RunExamplesOptions
): Promise<ExampleResult[]> {
  const vscode = await import("vscode");
  const ext = path.extname(uri.fsPath);
  const lang = langFromExt(ext);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
  const content = doc.getText();
  const blocks = parseExampleBlocks(content, lang);
  if (blocks.length === 0) return [];

  let stdout: string;
  let stderr: string;

  if (opts?.useProfiler && opts?.outputChannel) {
    const result = await runSolutionFileWithProfiling({
      filePath: uri.fsPath,
      lang,
      outputChannel: opts.outputChannel,
      enableCpuProfile: opts.enableCpuProfile ?? false,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } else {
    const result = await runSolutionFile(uri.fsPath, lang);
    stdout = result.stdout;
    stderr = result.stderr;
  }

  if (stderr) {
    const ch = stderr.trim();
    if (ch && !stdout) throw new Error(ch);
  }
  return compareOutput(content, stdout, lang);
}
