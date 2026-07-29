export interface Problem {
  id: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  content: string;
  /** Function signature + body placeholder (default/lang snippet for backward compat) */
  codeSnippet: string;
  /** All language snippets from API: langSlug -> code */
  codeSnippets?: Record<string, string>;
  sampleTestCase: string;
  exampleTestCases?: string[];
  /** LeetCode question category, e.g. "Algorithms" or "Database". Absent on the internal provider. */
  categoryTitle?: string;
  /** Raw JSON metadata blob; database problems carry `database: true` plus per-dialect DDL. */
  metaData?: string;
  /** Database problems only: pandas seed code, one DataFrame assignment per table. */
  dataSchemas?: string[];
}

/**
 * Languages a solution file can be written in. `mysql` and `pandas` only apply to
 * database problems; the rest only to algorithm problems. Ordering matters:
 * `languageStrategyFromExtension` resolves `.py` to the first match, so `python`
 * must stay ahead of `pandas`.
 */
export const SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "cpp",
  "java",
  "mysql",
  "pandas",
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DATABASE_LANGUAGES = ["mysql", "pandas"] as const;
export type DatabaseLanguage = (typeof DATABASE_LANGUAGES)[number];

/** Languages usable on algorithm (non-database) problems. */
export const ALGORITHM_LANGUAGES = SUPPORTED_LANGUAGES.filter(
  (l) => !(DATABASE_LANGUAGES as readonly string[]).includes(l)
) as readonly SupportedLanguage[];

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isDatabaseLanguage(value: string): value is DatabaseLanguage {
  return (DATABASE_LANGUAGES as readonly string[]).includes(value);
}

export interface IProblemProvider {
  getProblem(idOrSlug: string): Promise<Problem | null>;
}
