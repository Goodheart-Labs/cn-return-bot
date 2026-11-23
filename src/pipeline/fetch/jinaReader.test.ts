import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchWithJinaReader, JinaUnavailableError } from "./jinaReader";

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

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function answer(status: number, body: unknown) {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe("fetchWithJinaReader", () => {
  test("a readable page comes back as markdown under its title", async () => {
    answer(200, GOOD_PAGE);
    expect(await fetchWithJinaReader("https://example.com/a")).toEqual({ type: "page", markdown: `# ${GOOD_PAGE.data.title}\n\n${GOOD_PAGE.data.content}` });
  });

  test("the site's own 404 behind a 200 from Jina is a target error with that status", async () => {
    answer(200, SITE_404);
    expect(await fetchWithJinaReader("https://example.com/gone")).toEqual({ type: "target_error", status: 404 });
  });

  test("a CAPTCHA warning is a challenge", async () => {
    answer(200, CAPTCHA);
    expect(await fetchWithJinaReader("https://example.com/walled")).toEqual({ type: "challenge" });
  });

  test("an error answer from Jina is one failed step", async () => {
    answer(422, { code: 422, name: "AssertionFailureError", message: "Unexpected empty file: https://example.com" });
    const result = await fetchWithJinaReader("https://example.com/empty");
    expect(result.type).toBe("failed");
  });

  test("a container that is not running throws, because a person has to start it", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new TypeError("Unable to connect"), { code: "ECONNREFUSED" }));
    await expect(fetchWithJinaReader("https://example.com/a")).rejects.toBeInstanceOf(JinaUnavailableError);
  });

  test("a read that times out is one failed step", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await fetchWithJinaReader("https://example.com/slow")).type).toBe("failed");
  });
});
