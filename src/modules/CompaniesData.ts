import * as fs from "fs";
import * as path from "path";
import * as Logger from "./Logger";

export interface CompanyDatasetProblem {
  slug: string;
  title: string;
  difficulty: string;
  accept: number;
  topics: string[];
}

export interface CompanyDatasetEdge {
  i: number;
  freq: number;
}

export interface CompanyDataset {
  version: number;
  generatedAt: string;
  problems: CompanyDatasetProblem[];
  companies: Record<string, CompanyDatasetEdge[]>;
}

export interface ProblemLookup {
  topics: string[];
  companies: Array<{ name: string; freq: number }>;
}

let cachedDataset: CompanyDataset | null = null;
let cachedSlugToIndex: Map<string, number> | null = null;
let cachedSlugToCompanies: Map<string, Array<{ name: string; freq: number }>> | null = null;

function datasetPath(extensionPath: string): string {
  return path.join(extensionPath, "out", "data", "companies.json");
}

export function loadCompaniesDataset(extensionPath: string): CompanyDataset | null {
  if (cachedDataset) return cachedDataset;
  const p = datasetPath(extensionPath);
  try {
    const raw = fs.readFileSync(p, "utf-8");
    cachedDataset = JSON.parse(raw) as CompanyDataset;
    return cachedDataset;
  } catch (e) {
    Logger.logError(`CompaniesData: failed to load ${p}`, e);
    cachedDataset = null;
    return null;
  }
}

/** Drop in-memory caches; next access re-reads disk. */
export function invalidateCompaniesDataset(): void {
  cachedDataset = null;
  cachedSlugToIndex = null;
  cachedSlugToCompanies = null;
}

function ensureSlugIndex(data: CompanyDataset): Map<string, number> {
  if (cachedSlugToIndex) return cachedSlugToIndex;
  const m = new Map<string, number>();
  data.problems.forEach((p, i) => m.set(p.slug, i));
  cachedSlugToIndex = m;
  return m;
}

function ensureSlugToCompanies(
  data: CompanyDataset
): Map<string, Array<{ name: string; freq: number }>> {
  if (cachedSlugToCompanies) return cachedSlugToCompanies;
  const m = new Map<string, Array<{ name: string; freq: number }>>();
  for (const [name, edges] of Object.entries(data.companies)) {
    for (const edge of edges) {
      const slug = data.problems[edge.i]?.slug;
      if (!slug) continue;
      const arr = m.get(slug) ?? [];
      arr.push({ name, freq: edge.freq });
      m.set(slug, arr);
    }
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => b.freq - a.freq || a.name.localeCompare(b.name));
  }
  cachedSlugToCompanies = m;
  return m;
}

export function lookupProblem(extensionPath: string, slug: string): ProblemLookup | null {
  const data = loadCompaniesDataset(extensionPath);
  if (!data) return null;
  const idx = ensureSlugIndex(data).get(slug);
  if (idx === undefined) return null;
  const topics = data.problems[idx]?.topics ?? [];
  const companies = ensureSlugToCompanies(data).get(slug) ?? [];
  return { topics, companies };
}
