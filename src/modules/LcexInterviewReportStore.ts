import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { InterviewHistoryEntry } from "./InterviewMode";

export const LCEX_HOME_DIR = path.join(os.homedir(), ".lcex");

export interface LcInterviewReportHubRowSnapshot {
  titleSlug: string;
  title: string;
  practiceLabel: string;
  interviewSolved: boolean;
  secondsSpent?: number;
  interviewXpEarned?: number;
}

/** On-disk interview report (v1). */
export interface LcInterviewReportFileV1 {
  version: 1;
  interviewName: string;
  sourceLcInterviewPath: string;
  writtenAt: number;
  entry: InterviewHistoryEntry;
  hubRows: LcInterviewReportHubRowSnapshot[];
  /** Present for per-attempt reports stored under the interview solution folder. */
  attemptId?: string;
  solutionFolderPath?: string;
}

/** Resolved absolute path; uses realpath when the file exists so MD5 matches after write/read. */
export function normalizeInterviewFilePath(fsPath: string): string {
  const resolved = path.resolve(fsPath.trim());
  try {
    if (fs.existsSync(resolved)) {
      return fs.realpathSync(resolved);
    }
  } catch {
    /* keep resolved */
  }
  return resolved;
}

/** MD5 hex of UTF-8 normalized absolute path (legacy reports in ~/.lcex). */
export function getInterviewFileKey(fsPath: string): string {
  const normalized = normalizeInterviewFilePath(fsPath);
  return crypto.createHash("md5").update(normalized, "utf8").digest("hex");
}

export function getReportPathForInterviewFile(fsPath: string): string {
  const key = getInterviewFileKey(fsPath);
  return path.join(LCEX_HOME_DIR, `${key}.lcireport`);
}

export function getReportPathForAttempt(solutionFolderPath: string, attemptHex: string): string {
  const dir = path.resolve(solutionFolderPath.trim());
  const id = attemptHex.trim().toLowerCase();
  return path.join(dir, `report-${id}.lcireport`);
}

export function ensureLcexDir(): void {
  fs.mkdirSync(LCEX_HOME_DIR, { recursive: true });
}

/** @deprecated Prefer attempt-scoped reports under the interview folder. */
export function reportExistsForInterviewFile(fsPath: string): boolean {
  try {
    return fs.existsSync(getReportPathForInterviewFile(fsPath));
  } catch {
    return false;
  }
}

/** Writes a report next to solutions for a given attempt. */
export function writeInterviewReportAtPath(absPath: string, data: LcInterviewReportFileV1): void {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2), "utf-8");
}

/** Legacy: write under ~/.lcex using MD5 of interview file path. */
export function writeInterviewReportFile(data: LcInterviewReportFileV1): void {
  ensureLcexDir();
  const p = getReportPathForInterviewFile(data.sourceLcInterviewPath);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export function readInterviewReportFile(reportPath: string): LcInterviewReportFileV1 | undefined {
  try {
    const raw = fs.readFileSync(reportPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const o = parsed as Partial<LcInterviewReportFileV1>;
    if (o.version !== 1 || !o.entry || typeof o.sourceLcInterviewPath !== "string") return undefined;
    if (!Array.isArray(o.hubRows)) return undefined;
    return o as LcInterviewReportFileV1;
  } catch {
    return undefined;
  }
}

export function readInterviewReportForInterviewFile(fsPath: string): LcInterviewReportFileV1 | undefined {
  const p = getReportPathForInterviewFile(normalizeInterviewFilePath(fsPath));
  if (!fs.existsSync(p)) return undefined;
  return readInterviewReportFile(p);
}
