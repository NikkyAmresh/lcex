import type { IProblemProvider, Problem } from "./interface/Problem";
import * as Logger from "./Logger";

const GRAPHQL_URL = "https://leetcode.com/graphql/";
const REST_BASE = "https://leetcode.com";

const FETCH_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://leetcode.com",
  Referer: "https://leetcode.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    difficulty
    content
    codeSnippets { langSlug code }
    sampleTestCase
    exampleTestcases
  }
}
`;

interface LeetCodeQuestion {
  questionId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  content: string;
  codeSnippets?: Array<{ langSlug: string; code: string }>;
  sampleTestCase: string;
  exampleTestcases?: string;
}

export interface ProblemListItem {
  id: string;
  titleSlug: string;
  title: string;
  difficulty: string;
}

export interface DailyChallengeEntry {
  id: string;
  titleSlug: string;
  title: string;
  date: string;
}

const QOTD_QUERY = `
query questionOfToday {
  activeDailyCodingChallengeQuestion {
    link
  }
}
`;

const STUDY_PLAN_QUERY = `
query studyPlanPastSolved($slug: String!) {
  studyPlanV2Detail(planSlug: $slug) {
    planSubGroups {
      slug
      questions {
        titleSlug
        status
      }
    }
  }
}
`;

function slugToTitle(slug: string): string {
  const overrides: Record<string, string> = {
    "insert-delete-getrandom-o1": "Insert Delete GetRandom O(1)",
    "search-a-2d-matrix": "Search a 2D Matrix",
    "number-of-1-bits": "Number of 1 Bits",
    "sqrtx": "Sqrt(x)",
    "powx-n": "Pow(x, n)",
  };
  if (overrides[slug]) return overrides[slug];
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** API caps at ~100 per request; use this for pagination. */
const PROBLEMSET_PAGE_SIZE = 100;

/** Ensures the Cookie header value is in the form LEETCODE_SESSION=... for authenticated requests. */
function toCookieHeader(cookie: string): string {
  const trimmed = cookie.trim();
  const hasPrefix = trimmed.toLowerCase().startsWith("leetcode_session=");
  if (!hasPrefix) {
    Logger.log("Cookie: added LEETCODE_SESSION= prefix (stored value had no prefix)");
  }
  return hasPrefix ? trimmed : `LEETCODE_SESSION=${trimmed}`;
}

/** Extracts csrftoken from a cookie string (e.g. "LEETCODE_SESSION=...; csrftoken=abc123"). */
function getCsrfFromCookie(cookie: string): string | undefined {
  const match = cookie.trim().match(/\bcsrftoken=([^;\s]+)/i);
  return match ? match[1] : undefined;
}

/** Fetches csrftoken by GET leetcode.com and reading Set-Cookie. */
async function fetchCsrfToken(cookieHeader: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://leetcode.com/", {
      method: "GET",
      headers: {
        ...FETCH_HEADERS,
        Cookie: cookieHeader,
      },
    });
    const raw = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    const list = raw ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const sc of list) {
      const m = sc.match(/\bcsrftoken=([^;\s]+)/i);
      if (m) return m[1];
    }
    return undefined;
  } catch (e) {
    Logger.logError("fetchCsrfToken failed", e);
    return undefined;
  }
}

/** Builds headers for authenticated GraphQL requests (cookie + x-csrftoken). */
async function authHeaders(cookie: string): Promise<Record<string, string>> {
  const cookieHeader = toCookieHeader(cookie);
  let csrf = getCsrfFromCookie(cookieHeader);
  if (!csrf) {
    Logger.log("Cookie has no csrftoken; fetching from leetcode.com...");
    csrf = await fetchCsrfToken(cookieHeader);
    if (csrf) Logger.log("Got csrftoken from page.");
    else Logger.log("Could not get csrftoken. Paste full Cookie header including csrftoken from DevTools.");
  }
  const headers: Record<string, string> = { ...FETCH_HEADERS, Cookie: cookieHeader };
  if (csrf) headers["x-csrftoken"] = csrf;
  return headers;
}

export class LeetCodeProvider implements IProblemProvider {
  private slugCache: Map<string, string> = new Map();
  private slugToProblemItem: Map<string, ProblemListItem> | null = null;

  /** Fetches all problems from the problemset via pagination (API caps at ~100 per request). */
  async getFullProblemsetList(): Promise<ProblemListItem[]> {
    const all: ProblemListItem[] = [];
    for (let skip = 0; ; skip += PROBLEMSET_PAGE_SIZE) {
      const page = await this.getProblemList(skip, PROBLEMSET_PAGE_SIZE);
      all.push(...page);
      if (page.length < PROBLEMSET_PAGE_SIZE) break;
    }
    return all;
  }

  /** Builds slug -> ProblemListItem from the problemset (cached). */
  private async getSlugToProblemListItemMap(): Promise<Map<string, ProblemListItem>> {
    if (this.slugToProblemItem !== null) return this.slugToProblemItem;
    const list = await this.getFullProblemsetList();
    const map = new Map<string, ProblemListItem>();
    for (const q of list) {
      map.set(q.titleSlug, q);
    }
    this.slugToProblemItem = map;
    return map;
  }

  /** Returns the daily coding challenge question titleSlug, or null on failure. */
  async questionOfToday(): Promise<string | null> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: JSON.stringify({
        operationName: "questionOfToday",
        variables: {},
        query: QOTD_QUERY,
      }),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    let json: { data?: { activeDailyCodingChallengeQuestion?: { link?: string } } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const link = json.data?.activeDailyCodingChallengeQuestion?.link;
    if (!link || typeof link !== "string") return null;
    const match = /\/problems\/([^/]+)\/?/.exec(link);
    return match ? match[1] : null;
  }

  /** Returns daily challenges for a given year and month (one API call per month). */
  async getDailyChallengeList(year: number, month: number): Promise<DailyChallengeEntry[]> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: JSON.stringify({
        operationName: "dailyCodingChallengeList",
        variables: { year, month },
        query: `
          query dailyCodingChallengeList($year: Int!, $month: Int!) {
            dailyCodingChallengeList(year: $year, month: $month) {
              startDate
              dailyQuestions {
                questionTitle
                questionTitleSlug
                questionFrontendId
                date
              }
            }
          }
        `,
      }),
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];
    let json: {
      data?: {
        dailyCodingChallengeList?: Array<{
          dailyQuestions?: Array<{
            questionTitle: string;
            questionTitleSlug: string;
            questionFrontendId: string;
            date: string;
          }>;
        }>;
      };
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return [];
    }
    const nodes = json.data?.dailyCodingChallengeList ?? [];
    const entries: DailyChallengeEntry[] = [];
    for (const node of nodes) {
      for (const q of node.dailyQuestions ?? []) {
        entries.push({
          id: String(q.questionFrontendId),
          titleSlug: q.questionTitleSlug,
          title: q.questionTitle ?? q.questionTitleSlug,
          date: q.date,
        });
      }
    }
    return entries;
  }

  /** Returns ordered titleSlugs for a study plan (e.g. top-interview-150). */
  async getStudyPlanQuestionSlugs(planSlug: string): Promise<string[]> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: JSON.stringify({
        operationName: "studyPlanPastSolved",
        variables: { slug: planSlug },
        query: STUDY_PLAN_QUERY,
      }),
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];
    let json: {
      data?: {
        studyPlanV2Detail?: {
          planSubGroups?: Array<{ questions?: Array<{ titleSlug: string }> }>;
        };
      };
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return [];
    }
    const groups = json.data?.studyPlanV2Detail?.planSubGroups ?? [];
    const slugs: string[] = [];
    for (const g of groups) {
      for (const q of g.questions ?? []) {
        if (q.titleSlug) slugs.push(q.titleSlug);
      }
    }
    return slugs;
  }

  async getProblemList(skip: number, limit: number): Promise<ProblemListItem[]> {
    const listRes = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: JSON.stringify({
        operationName: "problemsetQuestionListV2",
        variables: { categorySlug: "", skip, limit },
        query: `
          query problemsetQuestionListV2($categorySlug: String, $limit: Int, $skip: Int) {
            problemsetQuestionListV2(categorySlug: $categorySlug, limit: $limit, skip: $skip) {
              questions { questionFrontendId titleSlug title difficulty }
            }
          }
        `,
      }),
    });
    if (!listRes.ok) return [];
    const listContentType = listRes.headers.get("content-type") ?? "";
    if (!listContentType.includes("application/json")) return [];
    let listJson: {
      data?: {
        problemsetQuestionListV2?: {
          questions?: Array<{
            questionFrontendId: string | number;
            titleSlug: string;
            title?: string;
            difficulty?: string;
          }>;
        };
      };
    };
    try {
      listJson = (await listRes.json()) as typeof listJson;
    } catch {
      return [];
    }
    const questions = listJson.data?.problemsetQuestionListV2?.questions ?? [];
    return questions.map((q) => ({
      id: String(q.questionFrontendId),
      titleSlug: q.titleSlug,
      title: q.title ?? q.titleSlug,
      difficulty: q.difficulty ?? "Unknown",
    }));
  }

  /** Returns problem list for a study plan (e.g. top-interview-150), ordered by API. */
  async getStudyPlanProblemList(planSlug: string): Promise<ProblemListItem[]> {
    const slugs = await this.getStudyPlanQuestionSlugs(planSlug);
    if (slugs.length === 0) return [];
    const slugToItem = await this.getSlugToProblemListItemMap();
    return slugs.map((titleSlug, i) => {
      const item = slugToItem.get(titleSlug);
      return (
        item ?? {
          id: String(i + 1),
          titleSlug,
          title: slugToTitle(titleSlug),
          difficulty: "Unknown",
        }
      );
    });
  }

  /**
   * Fetches the current user's profile and solved counts from LeetCode (requires valid session cookie).
   * Returns null if not authenticated or request fails.
   */
  async getUserProfileAndStats(cookie: string): Promise<{
    username: string;
    realName: string | null;
    userAvatar: string | null;
    easySolved: number;
    mediumSolved: number;
    hardSolved: number;
    totalSolved: number;
  } | null> {
    Logger.log("getUserProfileAndStats: fetching current user...");
    const headers = await authHeaders(cookie);
    const userStatusQuery = {
      operationName: "userStatus",
      variables: {},
      query: `
        query userStatus {
          userStatus {
            username
          }
        }
      `,
    };
    const globalDataQuery = {
      operationName: "globalData",
      variables: {},
      query: `
        query globalData {
          userStatus {
            username
          }
        }
      `,
    };
    let username: string | undefined;
    for (const body of [userStatusQuery, globalDataQuery]) {
      const userRes = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!userRes.ok) {
        const errBody = await userRes.text();
        Logger.log(`getUserProfileAndStats ${body.operationName}: HTTP ${userRes.status} ${errBody.slice(0, 300)}`);
        continue;
      }
      let userJson: {
        data?: {
          userStatus?: { username?: string };
          globalData?: { userStatus?: { username?: string } };
        };
        errors?: Array<{ message?: string }>;
      };
      try {
        userJson = (await userRes.json()) as typeof userJson;
      } catch (e) {
        Logger.logError("getUserProfileAndStats: parse JSON failed", e);
        continue;
      }
      if (userJson.errors?.length) {
        Logger.log(`getUserProfileAndStats ${body.operationName}: GraphQL errors ${JSON.stringify(userJson.errors)}`);
        continue;
      }
      username =
        userJson.data?.userStatus?.username ??
        userJson.data?.globalData?.userStatus?.username;
      if (username && typeof username === "string") {
        Logger.log(`getUserProfileAndStats: got username ${username}`);
        break;
      }
    }
    if (!username || typeof username !== "string") {
      Logger.log("getUserProfileAndStats: could not get username (check cookie or sign in)");
      return null;
    }

    const profileRes = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName: "userProfile",
        variables: { username },
        query: `
          query userProfile($username: String!) {
            matchedUser(username: $username) {
              profile { realName userAvatar }
              submitStats: submitStatsGlobal {
                acSubmissionNum {
                  difficulty
                  count
                }
              }
            }
          }
        `,
      }),
    });
    if (!profileRes.ok) {
      const errBody = await profileRes.text();
      Logger.log(`getUserProfileAndStats userProfile: HTTP ${profileRes.status} ${errBody.slice(0, 300)}`);
      return null;
    }
    let profileJson: {
      data?: {
        matchedUser?: {
          profile?: { realName?: string; userAvatar?: string };
          submitStats?: { acSubmissionNum?: Array<{ difficulty: string; count: number }> };
        };
      };
    };
    try {
      profileJson = (await profileRes.json()) as typeof profileJson;
    } catch {
      return null;
    }
    const matched = profileJson.data?.matchedUser;
    if (!matched) return null;

    const profile = matched.profile ?? {};
    const acNum = matched.submitStats?.acSubmissionNum ?? [];
    const byDiff: Record<string, number> = {};
    for (const { difficulty, count } of acNum) {
      byDiff[difficulty] = count;
    }
    return {
      username,
      realName: profile.realName ?? null,
      userAvatar: profile.userAvatar ?? null,
      easySolved: byDiff.Easy ?? 0,
      mediumSolved: byDiff.Medium ?? 0,
      hardSolved: byDiff.Hard ?? 0,
      totalSolved:
        byDiff.All ??
        (byDiff.Easy ?? 0) + (byDiff.Medium ?? 0) + (byDiff.Hard ?? 0),
    };
  }

  async getProblem(idOrSlug: string): Promise<Problem | null> {
    const slug = await this.toTitleSlug(idOrSlug);
    if (!slug) return null;
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: JSON.stringify({
        operationName: "questionData",
        variables: { titleSlug: slug },
        query: QUESTION_QUERY,
      }),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    let json: { data?: { question?: LeetCodeQuestion } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const q = json.data?.question;
    if (!q) return null;
    const exampleTestcases = q.exampleTestcases
      ? q.exampleTestcases.split("\n\n").filter(Boolean)
      : undefined;
    const codeSnippets: Record<string, string> = {};
    for (const s of q.codeSnippets ?? []) {
      if (s.langSlug && s.code) codeSnippets[s.langSlug] = s.code;
    }
    const tsSnippet = codeSnippets["typescript"];
    return {
      id: q.questionId,
      title: q.title,
      titleSlug: q.titleSlug,
      difficulty: q.difficulty,
      content: q.content ?? "",
      codeSnippet: tsSnippet ?? "",
      codeSnippets,
      sampleTestCase: q.sampleTestCase ?? "",
      exampleTestCases: exampleTestcases,
    };
  }

  private async toTitleSlug(idOrSlug: string): Promise<string | null> {
    const trimmed = idOrSlug.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return trimmed;
    const cached = this.slugCache.get(trimmed);
    if (cached) return cached;
    const slug = await this.fetchSlugById(trimmed);
    if (slug) this.slugCache.set(trimmed, slug);
    return slug;
  }

  private async fetchSlugById(id: string): Promise<string | null> {
    const limit = 100;
    for (let skip = 0; skip < 3000; skip += limit) {
      const listRes = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: FETCH_HEADERS,
        body: JSON.stringify({
          operationName: "problemsetQuestionListV2",
          variables: { categorySlug: "", skip, limit },
          query: `
            query problemsetQuestionListV2($categorySlug: String, $limit: Int, $skip: Int) {
              problemsetQuestionListV2(categorySlug: $categorySlug, limit: $limit, skip: $skip) {
                questions { questionFrontendId titleSlug }
              }
            }
          `,
        }),
      });
      if (!listRes.ok) return null;
      const listContentType = listRes.headers.get("content-type") ?? "";
      if (!listContentType.includes("application/json")) return null;
      let listJson: {
        data?: {
          problemsetQuestionListV2?: {
            questions?: Array<{ questionFrontendId: string | number; titleSlug: string }>;
          };
        };
      };
      try {
        listJson = (await listRes.json()) as typeof listJson;
      } catch {
        return null;
      }
      const questions = listJson.data?.problemsetQuestionListV2?.questions ?? [];
      const found = questions.find((q) => String(q.questionFrontendId) === id);
      if (found) return found.titleSlug;
      if (questions.length < limit) break;
    }
    return null;
  }

  async runCode(
    titleSlug: string,
    code: string,
    lang: string,
    cookie: string,
    dataInput?: string
  ): Promise<{ interpretId: string } | null> {
    Logger.log(`runCode: ${titleSlug} lang=${lang}`);
    const question = await this.getProblem(titleSlug);
    if (!question) {
      Logger.log("runCode: getProblem returned null");
      return null;
    }
    const input = dataInput !== undefined && dataInput !== null ? dataInput : (question.sampleTestCase ?? "");
    const headers = await authHeaders(cookie);
    const url = `${REST_BASE}/problems/${encodeURIComponent(titleSlug)}/interpret_solution/`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, Referer: `https://leetcode.com/problems/${titleSlug}/` },
      body: JSON.stringify({
        lang,
        question_id: question.id,
        typed_code: code,
        data_input: input,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      Logger.log(`runCode: HTTP ${res.status} ${errBody.slice(0, 400)}`);
      return null;
    }
    let json: { interpret_id?: string; interpretId?: string };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const interpretId = json.interpret_id ?? json.interpretId;
    if (interpretId) {
      Logger.log(`runCode: got interpretId ${interpretId}`);
    } else {
      Logger.log("runCode: response missing interpret_id");
    }
    return interpretId ? { interpretId } : null;
  }

  async submitCode(
    titleSlug: string,
    code: string,
    lang: string,
    cookie: string
  ): Promise<{ submissionId: number } | null> {
    Logger.log(`submitCode: ${titleSlug} lang=${lang}`);
    const slug = await this.toTitleSlug(titleSlug);
    if (!slug) {
      Logger.log("submitCode: toTitleSlug returned null");
      return null;
    }
    const question = await this.getProblem(slug);
    if (!question) {
      Logger.log("submitCode: getProblem returned null");
      return null;
    }
    const headers = await authHeaders(cookie);
    const url = `${REST_BASE}/problems/${encodeURIComponent(slug)}/submit/`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, Referer: `https://leetcode.com/problems/${slug}/` },
      body: JSON.stringify({
        lang,
        question_id: question.id,
        typed_code: code,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      Logger.log(`submitCode: HTTP ${res.status} ${errBody.slice(0, 400)}`);
      return null;
    }
    let json: { submission_id?: number; submissionId?: number };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const submissionId = json.submission_id ?? json.submissionId;
    if (submissionId != null) {
      Logger.log(`submitCode: got submissionId ${submissionId}`);
    } else {
      Logger.log("submitCode: response missing submission_id");
    }
    return submissionId != null ? { submissionId } : null;
  }

  async getRunStatus(
    interpretId: string,
    cookie: string
  ): Promise<{ status: number; runOutput?: string; compileError?: string } | null> {
    const headers = await authHeaders(cookie);
    const url = `${REST_BASE}/submissions/detail/${encodeURIComponent(interpretId)}/check/`;
    const res = await fetch(url, {
      method: "GET",
      headers: { ...headers, Referer: "https://leetcode.com/problems/" },
    });
    if (!res.ok) {
      const errBody = await res.text();
      Logger.log(`getRunStatus: HTTP ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }
    let json: {
      state?: string;
      status_code?: number;
      statusCode?: number;
      run_output?: string;
      runOutput?: string;
      full_compile_error?: string;
      compile_error?: string;
      compileError?: string;
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const state = (json.state ?? "").toUpperCase();
    if (state === "PENDING" || state === "STARTED") {
      return { status: 10 };
    }
    const status = json.status_code ?? json.statusCode ?? 0;
    const runOutput = json.run_output ?? json.runOutput;
    const compileError = json.full_compile_error ?? json.compile_error ?? json.compileError;
    return { status, runOutput, compileError };
  }

  async getSubmitStatus(
    submissionId: number,
    cookie: string
  ): Promise<{
    status: string;
    runSuccess?: boolean;
    compileError?: string;
    runtimeError?: string;
  } | null> {
    const headers = await authHeaders(cookie);
    const url = `${REST_BASE}/submissions/detail/${submissionId}/check/`;
    const res = await fetch(url, {
      method: "GET",
      headers: { ...headers, Referer: "https://leetcode.com/problems/" },
    });
    if (!res.ok) {
      const errBody = await res.text();
      Logger.log(`getSubmitStatus: HTTP ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }
    let json: {
      state?: string;
      status?: string;
      run_success?: boolean;
      runSuccess?: boolean;
      full_compile_error?: string;
      compile_error?: string;
      compileError?: string;
      runtime_error?: string;
      runtimeError?: string;
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return null;
    }
    const state = (json.state ?? "").toUpperCase();
    const status = state ? state : (json.status ?? "PENDING");
    return {
      status,
      runSuccess: json.run_success ?? json.runSuccess,
      compileError: json.full_compile_error ?? json.compile_error ?? json.compileError,
      runtimeError: json.runtime_error ?? json.runtimeError,
    };
  }
}
