import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { fetchWithJinaReader, JinaAccountError } from "./jinaReader";
import { getCostTracker, withCostTracker } from "../cost-tracking/costTracker";

// The shapes below are copied from real Jina answers recorded during GOO-167.
const GOOD_PAGE = {
  code: 200,
  data: {
    title: "What's next for Lindsay Clancy after mistrial?",
    content: "Sept 4 (Reuters) - A judge declared a mistrial ...",
    usage: { tokens: 9397 },
  },
};
const SITE_404 = {
  code: 200,
  data: { title: "Page not found", content: "Page not found ...", warning: "Target URL returned error 404: Not Found", usage: { tokens: 2699 } },
};
const CAPTCHA = {
  code: 200,
  data: { title: "cbo.gov", content: "", warning: "This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.", usage: { tokens: 0 } },
};

const savedKey = process.env.JINA_API_KEY;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function answer(status: number, body: unknown) {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  process.env.JINA_API_KEY = "test";
});
afterEach(() => {
  fetchSpy?.mockRestore();
  if (savedKey === undefined) delete process.env.JINA_API_KEY;
  else process.env.JINA_API_KEY = savedKey;
});

describe("fetchWithJinaReader", () => {
  test("a readable page comes back as markdown under its title, and its cost is tracked", async () => {
    answer(200, GOOD_PAGE);
    const { result, costs } = await withCostTracker(async () => ({ result: await fetchWithJinaReader("https://example.com/a"), costs: getCostTracker() }));
    expect(result).toEqual({ type: "page", markdown: `# ${GOOD_PAGE.data.title}\n\n${GOOD_PAGE.data.content}` });
    expect(costs).toHaveLength(1);
    expect(costs[0]!.cost).toBeCloseTo(9397 * 0.05 / 1_000_000, 10);
  });

  test("the site's own 404 behind a 200 from Jina is a target error with that status", async () => {
    answer(200, SITE_404);
    expect(await fetchWithJinaReader("https://example.com/gone")).toEqual({ type: "target_error", status: 404 });
  });

  test("a CAPTCHA warning is a challenge", async () => {
    answer(200, CAPTCHA);
    expect(await fetchWithJinaReader("https://example.com/walled")).toEqual({ type: "challenge" });
  });

  test("a domain Jina refuses to read is one failed step", async () => {
    answer(451, { code: 451, message: "This domain is excluded from Jina Reader" });
    const result = await fetchWithJinaReader("https://example.com/excluded");
    expect(result.type).toBe("failed");
  });

  test("a used-up balance throws, because a person has to top it up", async () => {
    answer(402, { code: 402, message: "Insufficient balance" });
    await expect(fetchWithJinaReader("https://example.com/a")).rejects.toBeInstanceOf(JinaAccountError);
  });

  test("a missing key throws before any request", async () => {
    delete process.env.JINA_API_KEY;
    fetchSpy = spyOn(globalThis, "fetch");
    await expect(fetchWithJinaReader("https://example.com/a")).rejects.toThrow("JINA_API_KEY missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
