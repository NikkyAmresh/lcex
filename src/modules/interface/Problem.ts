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

export type SupportedLanguage = "typescript" | "javascript" | "python";

export const LEETCODE_LANG_SLUG: Record<SupportedLanguage, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python3",
};

export interface IProblemProvider {
  getProblem(idOrSlug: string): Promise<Problem | null>;
}
