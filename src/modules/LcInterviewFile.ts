import type { PlannedInterviewProblem } from "./InterviewMode";

export const LC_INTERVIEW_VERSION = 1 as const;

/** Three lowercase hex digits per interview attempt (e.g. "0a3"). */
export const ATTEMPT_ID_RE = /^[0-9a-f]{3}$/;

export interface LcInterviewAttemptEntry {
  id: string;
  time: string;
}

export interface LcInterviewFileV1 {
  version: typeof LC_INTERVIEW_VERSION;
  name: string;
  durationMinutes: 45 | 60 | 180;
  problems: PlannedInterviewProblem[];
  attempts?: LcInterviewAttemptEntry[];
}

const ALLOWED_DURATION = new Set<number>([45, 60, 180]);

export function defaultInterviewNameFromDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeProblems(raw: unknown): PlannedInterviewProblem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedInterviewProblem[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const slug = item.trim();
      if (slug) out.push({ titleSlug: slug, difficulty: "MEDIUM" });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as { titleSlug?: unknown }).titleSlug === "string") {
      const titleSlug = String((item as { titleSlug: string }).titleSlug).trim();
      if (!titleSlug) continue;
      const diffRaw = (item as { difficulty?: unknown }).difficulty;
      const difficulty =
        typeof diffRaw === "string" && diffRaw.trim()
          ? String(diffRaw).trim().toUpperCase()
          : "MEDIUM";
      out.push({ titleSlug, difficulty });
    }
  }
  return out;
}

function normalizeAttempts(raw: unknown): LcInterviewAttemptEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LcInterviewAttemptEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const idRaw = (item as { id?: unknown }).id;
    const timeRaw = (item as { time?: unknown }).time;
    if (typeof idRaw !== "string" || typeof timeRaw !== "string") continue;
    const id = idRaw.trim().toLowerCase();
    if (!ATTEMPT_ID_RE.test(id)) continue;
    const time = timeRaw.trim();
    if (!time) continue;
    out.push({ id, time });
  }
  return out.length > 0 ? out : [];
}

export function parseLcInterviewFile(text: string): { ok: true; data: LcInterviewFileV1 } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: true,
      data: {
        version: LC_INTERVIEW_VERSION,
        name: defaultInterviewNameFromDate(),
        durationMinutes: 45,
        problems: [],
        attempts: [],
      },
    };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const version = typeof parsed.version === "number" ? parsed.version : LC_INTERVIEW_VERSION;
    if (version !== 1) {
      return { ok: false, message: `Unsupported version: ${version}` };
    }
    const dm = typeof parsed.durationMinutes === "number" ? parsed.durationMinutes : 45;
    if (!ALLOWED_DURATION.has(dm)) {
      return { ok: false, message: "durationMinutes must be 45, 60, or 180." };
    }
    const problems = normalizeProblems(parsed.problems);
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : defaultInterviewNameFromDate();
    const attempts = normalizeAttempts(parsed.attempts);
    return {
      ok: true,
      data: {
        version: LC_INTERVIEW_VERSION,
        name,
        durationMinutes: dm as 45 | 60 | 180,
        problems,
        ...(attempts !== undefined ? { attempts } : {}),
      },
    };
  } catch {
    return { ok: false, message: "Invalid JSON." };
  }
}

export function serializeLcInterviewFile(data: LcInterviewFileV1): string {
  return JSON.stringify(data, null, 2);
}
