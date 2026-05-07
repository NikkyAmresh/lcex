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
}

export const SUPPORTED_LANGUAGES = ["typescript", "javascript", "python", "cpp", "java"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export interface IProblemProvider {
  getProblem(idOrSlug: string): Promise<Problem | null>;
}
