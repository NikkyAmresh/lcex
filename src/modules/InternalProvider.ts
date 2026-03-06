import type { IProblemProvider, Problem } from "./interface/Problem";

/**
 * Fetches problem from an internal API. Expects JSON of shape:
 * { id, title, titleSlug?, difficulty?, content?, codeSnippet, sampleTestCase, exampleTestCases? }
 * GET {baseUrl}/problem/{idOrSlug}
 */
export class InternalApiProvider implements IProblemProvider {
  constructor(private baseUrl: string) {}

  async getProblem(idOrSlug: string): Promise<Problem | null> {
    const url = this.baseUrl.replace(/\/$/, "") + "/problem/" + encodeURIComponent(idOrSlug.trim());
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return this.normalize(raw, idOrSlug);
  }

  private normalize(raw: Record<string, unknown>, fallbackId: string): Problem {
    const id = String(raw.id ?? raw.questionId ?? fallbackId);
    const title = String(raw.title ?? "Untitled");
    const titleSlug = String(raw.titleSlug ?? raw.title ?? fallbackId)
      .replace(/\s+/g, "-")
      .toLowerCase();
    const codeSnippet =
      typeof raw.codeSnippet === "object" && raw.codeSnippet && "code" in raw.codeSnippet
        ? String((raw.codeSnippet as { code: unknown }).code)
        : String(raw.codeSnippet ?? "");
    const sampleTestCase = String(raw.sampleTestCase ?? "");
    const exampleTestCases = Array.isArray(raw.exampleTestCases)
      ? raw.exampleTestCases.map(String)
      : raw.exampleTestcases
        ? String(raw.exampleTestcases).split("\n\n").filter(Boolean)
        : undefined;
    return {
      id,
      title,
      titleSlug,
      difficulty: String(raw.difficulty ?? ""),
      content: String(raw.content ?? ""),
      codeSnippet,
      sampleTestCase,
      exampleTestCases,
    };
  }
}
