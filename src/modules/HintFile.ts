/** On-disk JSON for agent hints (`.hint` files). Structured fields only — no markdown blob. */

/** How strong the learner’s **Current** line is vs what this problem expects (set by the skill/agent, not inferred). */
export type HintCurrentRating = "good" | "avg" | "worst";

export function parseHintCurrentRating(raw: unknown): HintCurrentRating | undefined {
  return raw === "good" || raw === "avg" || raw === "worst" ? raw : undefined;
}

export type HintEfficiencyAxis = {
  current?: string;
  suggested?: string;
  suggestion?: string;
  /** UI color for **Current** (problem-relative: O(n²) can be `good` on an n×m grid). */
  currentRating?: HintCurrentRating;
};

export type HintEfficiency = {
  time?: HintEfficiencyAxis;
  space?: HintEfficiencyAxis;
};

export type HintApproach = {
  current?: string;
  suggested?: string;
  keyIdea?: string;
  /** UI color for **Current** (pattern quality vs problem — not raw big-O). */
  currentRating?: HintCurrentRating;
};

export type HintCodeStyle = {
  readability?: string;
  structure?: string;
  suggestions?: string;
};

export type LeetcodeHintFileV1 = {
  version: 1;
  titleSlug: string;
  problemTitle?: string;
  approach?: HintApproach;
  efficiency?: HintEfficiency;
  codeStyle?: HintCodeStyle;
  /** @deprecated Migrated into structured fields; not written on save */
  markdown?: string;
  updatedAt?: string;
};

function nonEmpty(s: string | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

function axisHasContent(a: HintEfficiencyAxis | undefined): boolean {
  if (!a) return false;
  return nonEmpty(a.current) || nonEmpty(a.suggested) || nonEmpty(a.suggestion);
}

export function hasStructuredHintContent(d: LeetcodeHintFileV1): boolean {
  const ap = d.approach;
  if (ap && (nonEmpty(ap.current) || nonEmpty(ap.suggested) || nonEmpty(ap.keyIdea))) return true;
  const ef = d.efficiency;
  if (ef && (axisHasContent(ef.time) || axisHasContent(ef.space))) return true;
  const cs = d.codeStyle;
  if (cs && (nonEmpty(cs.readability) || nonEmpty(cs.structure) || nonEmpty(cs.suggestions))) return true;
  return false;
}

function sliceBetweenHeaders(full: string, start: RegExp, end: RegExp): string {
  const sm = full.match(start);
  if (!sm || sm.index === undefined) return "";
  const tail = full.slice(sm.index + sm[0].length);
  const em = tail.match(end);
  if (em && em.index !== undefined) return tail.slice(0, em.index).trim();
  return tail.trim();
}

function afterHeader(full: string, start: RegExp): string {
  const sm = full.match(start);
  if (!sm || sm.index === undefined) return "";
  return full.slice(sm.index + sm[0].length).trim();
}

function parseBulletMap(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    const m = trimmed.match(/^[-*]\s+\*\*([^*]+):\*\*\s*(.*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

function migrateLegacyMarkdown(markdown: string): Pick<LeetcodeHintFileV1, "approach" | "efficiency" | "codeStyle"> {
  const full = markdown.replace(/\r\n/g, "\n");
  const appH = /^#{1,3}\s*Approach\s*$/im;
  const effH = /^#{1,3}\s*Efficiency\s*$/im;
  const csH = /^#{1,3}\s*Code\s*style\s*$/im;

  let approachBlock = sliceBetweenHeaders(full, appH, effH);
  let effBlock = sliceBetweenHeaders(full, effH, csH);
  let csBlock = afterHeader(full, csH);

  if (!approachBlock && !effBlock && !csBlock && full.trim()) {
    approachBlock = full;
  } else if (!approachBlock && !appH.test(full)) {
    const m1 = full.match(effH);
    const m2 = full.match(csH);
    let cut = full.length;
    if (m1?.index !== undefined) cut = Math.min(cut, m1.index);
    if (m2?.index !== undefined) cut = Math.min(cut, m2.index);
    if (cut < full.length) approachBlock = full.slice(0, cut).trim();
  }

  const approachBullets = parseBulletMap(approachBlock);
  const approach: HintApproach | undefined =
    nonEmpty(approachBullets.current) ||
    nonEmpty(approachBullets.suggested) ||
    nonEmpty(approachBullets["key idea"])
      ? {
          current: approachBullets.current,
          suggested: approachBullets.suggested,
          keyIdea: approachBullets["key idea"],
        }
      : undefined;

  const timeSub = effBlock.match(/\*\*Time complexity\*\*([\s\S]*?)(?=\*\*Space complexity\*\*|$)/i);
  const spaceSub = effBlock.match(/\*\*Space complexity\*\*([\s\S]*)/i);
  const timeB = timeSub ? timeSub[1].trim() : "";
  const spaceB = spaceSub ? spaceSub[1].trim() : "";
  const timeMap = parseBulletMap(timeB);
  const spaceMap = parseBulletMap(spaceB);
  const timeAxis: HintEfficiencyAxis | undefined =
    nonEmpty(timeMap.current) || nonEmpty(timeMap.suggested) || nonEmpty(timeMap.suggestion)
      ? {
          current: timeMap.current,
          suggested: timeMap.suggested,
          suggestion: timeMap.suggestion,
        }
      : undefined;
  const spaceAxis: HintEfficiencyAxis | undefined =
    nonEmpty(spaceMap.current) || nonEmpty(spaceMap.suggested) || nonEmpty(spaceMap.suggestion)
      ? {
          current: spaceMap.current,
          suggested: spaceMap.suggested,
          suggestion: spaceMap.suggestion,
        }
      : undefined;
  const efficiency: HintEfficiency | undefined =
    timeAxis || spaceAxis ? { ...(timeAxis ? { time: timeAxis } : {}), ...(spaceAxis ? { space: spaceAxis } : {}) } : undefined;

  const csMap = parseBulletMap(csBlock);
  const codeStyle: HintCodeStyle | undefined =
    nonEmpty(csMap.readability) || nonEmpty(csMap.structure) || nonEmpty(csMap.suggestions)
      ? {
          readability: csMap.readability,
          structure: csMap.structure,
          suggestions: csMap.suggestions,
        }
      : undefined;

  return { approach, efficiency, codeStyle };
}

/** Merge legacy `markdown` into structured fields when needed; drop `markdown` from the result. */
export function normalizeHintData(data: LeetcodeHintFileV1): LeetcodeHintFileV1 {
  let next: LeetcodeHintFileV1 = { ...data, version: 1 };
  if (!hasStructuredHintContent(next) && nonEmpty(next.markdown)) {
    const m = migrateLegacyMarkdown(next.markdown!);
    next = {
      ...next,
      approach: m.approach ?? next.approach,
      efficiency: m.efficiency ?? next.efficiency,
      codeStyle: m.codeStyle ?? next.codeStyle,
    };
  }
  const { markdown: _drop, ...rest } = next;
  return rest as LeetcodeHintFileV1;
}

export function createDefaultHintFileJson(titleSlug: string, problemTitle: string): string {
  const doc: LeetcodeHintFileV1 = {
    version: 1,
    titleSlug,
    problemTitle,
    updatedAt: new Date().toISOString(),
  };
  return serializeHintFile(doc);
}

export function parseHintFileJson(
  text: string
): { ok: true; data: LeetcodeHintFileV1 } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) {
    return { ok: false, error: "Empty file" };
  }
  try {
    const raw = JSON.parse(t) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Invalid JSON" };
    }
    const o = raw as Record<string, unknown>;
    if (o.version !== 1) {
      return { ok: false, error: 'Expected "version": 1' };
    }
    if (typeof o.titleSlug !== "string" || !o.titleSlug.trim()) {
      return { ok: false, error: "Missing titleSlug" };
    }

    const readAxis = (x: unknown): HintEfficiencyAxis | undefined => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
      const a = x as Record<string, unknown>;
      const axis: HintEfficiencyAxis = {};
      if (typeof a.current === "string") axis.current = a.current;
      if (typeof a.suggested === "string") axis.suggested = a.suggested;
      if (typeof a.suggestion === "string") axis.suggestion = a.suggestion;
      const cr = parseHintCurrentRating(a.currentRating);
      if (cr) axis.currentRating = cr;
      return axisHasContent(axis) ? axis : undefined;
    };

    const readEff = (x: unknown): HintEfficiency | undefined => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
      const e = x as Record<string, unknown>;
      const time = readAxis(e.time);
      const space = readAxis(e.space);
      if (!time && !space) return undefined;
      return { ...(time ? { time } : {}), ...(space ? { space } : {}) };
    };

    const readApproach = (x: unknown): HintApproach | undefined => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
      const a = x as Record<string, unknown>;
      const ap: HintApproach = {};
      if (typeof a.current === "string") ap.current = a.current;
      if (typeof a.suggested === "string") ap.suggested = a.suggested;
      if (typeof a.keyIdea === "string") ap.keyIdea = a.keyIdea;
      const cr = parseHintCurrentRating(a.currentRating);
      if (cr) ap.currentRating = cr;
      return nonEmpty(ap.current) || nonEmpty(ap.suggested) || nonEmpty(ap.keyIdea) ? ap : undefined;
    };

    const readCodeStyle = (x: unknown): HintCodeStyle | undefined => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
      const c = x as Record<string, unknown>;
      const cs: HintCodeStyle = {};
      if (typeof c.readability === "string") cs.readability = c.readability;
      if (typeof c.structure === "string") cs.structure = c.structure;
      if (typeof c.suggestions === "string") cs.suggestions = c.suggestions;
      return nonEmpty(cs.readability) || nonEmpty(cs.structure) || nonEmpty(cs.suggestions) ? cs : undefined;
    };

    const data: LeetcodeHintFileV1 = {
      version: 1,
      titleSlug: o.titleSlug.trim(),
      problemTitle: typeof o.problemTitle === "string" ? o.problemTitle : undefined,
      approach: readApproach(o.approach),
      efficiency: readEff(o.efficiency),
      codeStyle: readCodeStyle(o.codeStyle),
      markdown: typeof o.markdown === "string" ? o.markdown : undefined,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
    };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

function pruneApproach(a: HintApproach): HintApproach | undefined {
  const o: HintApproach = {};
  if (nonEmpty(a.current)) o.current = a.current!.trim();
  if (nonEmpty(a.suggested)) o.suggested = a.suggested!.trim();
  if (nonEmpty(a.keyIdea)) o.keyIdea = a.keyIdea!.trim();
  const cr = parseHintCurrentRating(a.currentRating);
  if (cr) o.currentRating = cr;
  return Object.keys(o).length ? o : undefined;
}

function pruneAxis(a: HintEfficiencyAxis): HintEfficiencyAxis | undefined {
  const o: HintEfficiencyAxis = {};
  if (nonEmpty(a.current)) o.current = a.current!.trim();
  if (nonEmpty(a.suggested)) o.suggested = a.suggested!.trim();
  if (nonEmpty(a.suggestion)) o.suggestion = a.suggestion!.trim();
  const cr = parseHintCurrentRating(a.currentRating);
  if (cr) o.currentRating = cr;
  return Object.keys(o).length ? o : undefined;
}

function pruneEfficiency(e: HintEfficiency): HintEfficiency | undefined {
  const time = e.time ? pruneAxis(e.time) : undefined;
  const space = e.space ? pruneAxis(e.space) : undefined;
  if (!time && !space) return undefined;
  return { ...(time ? { time } : {}), ...(space ? { space } : {}) };
}

function pruneCodeStyle(c: HintCodeStyle): HintCodeStyle | undefined {
  const o: HintCodeStyle = {};
  if (nonEmpty(c.readability)) o.readability = c.readability!.trim();
  if (nonEmpty(c.structure)) o.structure = c.structure!.trim();
  if (nonEmpty(c.suggestions)) o.suggestions = c.suggestions!.trim();
  return Object.keys(o).length ? o : undefined;
}

/** Canonical JSON on disk: structured fields only, no `markdown`. */
export function serializeHintFile(data: LeetcodeHintFileV1): string {
  const normalized = normalizeHintData(data);
  const out: LeetcodeHintFileV1 = {
    version: 1,
    titleSlug: normalized.titleSlug.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (nonEmpty(normalized.problemTitle)) out.problemTitle = normalized.problemTitle!.trim();
  const ap = normalized.approach ? pruneApproach(normalized.approach) : undefined;
  if (ap) out.approach = ap;
  const ef = normalized.efficiency ? pruneEfficiency(normalized.efficiency) : undefined;
  if (ef) out.efficiency = ef;
  const cs = normalized.codeStyle ? pruneCodeStyle(normalized.codeStyle) : undefined;
  if (cs) out.codeStyle = cs;
  return JSON.stringify(out, null, 2);
}

/** Merge clipboard JSON into existing slug/title; expects structured fields or legacy markdown. */
export function mergeHintFromClipboardJson(
  existing: LeetcodeHintFileV1,
  clipText: string
): { ok: true; data: LeetcodeHintFileV1 } | { ok: false; error: string } {
  const t = clipText.trim();
  if (!t) return { ok: false, error: "Empty clipboard" };
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Clipboard is not a JSON object" };
    }
    const merged: LeetcodeHintFileV1 = {
      ...existing,
      version: 1,
      titleSlug: typeof parsed.titleSlug === "string" && parsed.titleSlug.trim() ? parsed.titleSlug.trim() : existing.titleSlug,
      problemTitle:
        typeof parsed.problemTitle === "string" && parsed.problemTitle.trim()
          ? parsed.problemTitle.trim()
          : existing.problemTitle,
    };
    if (parsed.approach && typeof parsed.approach === "object" && !Array.isArray(parsed.approach)) {
      const pa = parsed.approach as HintApproach;
      merged.approach = { ...merged.approach, ...pa };
    }
    if (parsed.efficiency && typeof parsed.efficiency === "object" && !Array.isArray(parsed.efficiency)) {
      const pe = parsed.efficiency as HintEfficiency;
      const prev = merged.efficiency;
      const time = pe.time || prev?.time ? { ...prev?.time, ...pe.time } : undefined;
      const space = pe.space || prev?.space ? { ...prev?.space, ...pe.space } : undefined;
      if (time || space) {
        merged.efficiency = { ...(time ? { time } : {}), ...(space ? { space } : {}) };
      }
    }
    if (parsed.codeStyle && typeof parsed.codeStyle === "object" && !Array.isArray(parsed.codeStyle)) {
      merged.codeStyle = { ...merged.codeStyle, ...(parsed.codeStyle as HintCodeStyle) };
    }
    if (typeof parsed.markdown === "string" && parsed.markdown.trim()) {
      merged.markdown = parsed.markdown;
    }
    return { ok: true, data: normalizeHintData(merged) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

export function emptyHintContentPreserveMeta(base: LeetcodeHintFileV1): LeetcodeHintFileV1 {
  return normalizeHintData({
    version: 1,
    titleSlug: base.titleSlug,
    problemTitle: base.problemTitle,
  });
}
