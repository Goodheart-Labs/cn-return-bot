import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as client from "../../service/client";
import { FETCH_API_IN_BROWSER_PATH, FETCH_API_PATH, FETCH_PAGE_PATH, type ApiAnswer, type LadderAnswer } from "../../service/contract";
import * as jina from "./jinaReader";
import { readPage } from "./readPage";

/* Every answer below is faked, so these tests check only the order of the
 * stages: which step readPage asks next, given what the step before it said. */

const FORUM_POST = "https://www.lesswrong.com/posts/KgwQchapx4vJDhfYC/generalized-atheism";
const SUBSTACK_POST = "https://www.normaltech.ai/p/a-big-tent";
const PLAIN_PAGE = "https://example.com/report";

const ARTICLE = `# The title\n\n${"The article text goes on for a while. ".repeat(40)}`;
const forumAnswer = (result: object): ApiAnswer => ({ type: "answer", body: JSON.stringify({ data: { post: { result } } }) });
const FORUM_POST_ANSWER = forumAnswer({ _id: "KgwQchapx4vJDhfYC", pageUrl: FORUM_POST, title: "Generalized atheism", postedAt: "2026-08-05T18:35:09Z", htmlBody: "<p>The post's body.</p>", user: { displayName: "Eliezer Yudkowsky", slug: "eliezer_yudkowsky" } });
const SUBSTACK_ANSWER: ApiAnswer = { type: "answer", body: JSON.stringify({ title: "A big tent", subtitle: null, post_date: "2026-10-01T16:34:51Z", cover_image: null, canonical_url: SUBSTACK_POST, body_html: "<p>The post's body.</p>", publication_id: 1, publishedBylines: [] }) };
const LADDER_PAGE: LadderAnswer = { ok: true, html: "<html></html>", markdown: ARTICLE, fetchedUrl: PLAIN_PAGE, via: null, attempts: [] };
const LADDER_FAILED: LadderAnswer = { ok: false, diagnostic: "HTTP 403 (last attempt: browser)", attempts: [] };

/** The steps readPage took, in order. */
let steps: string[];
const spies: Array<{ mockRestore: () => void }> = [];

/** Fakes the fetcher's routes and Jina. Each route answers from its own list,
 *  one answer per call. */
function fake(answers: { [FETCH_API_PATH]?: ApiAnswer[]; [FETCH_API_IN_BROWSER_PATH]?: ApiAnswer[]; [FETCH_PAGE_PATH]?: LadderAnswer[]; jinaApi?: ApiAnswer[]; jinaPage?: jina.JinaReaderResult[] }) {
  const next = <T,>(list: T[] | undefined, step: string): T => {
    steps.push(step);
    const answer = list?.shift();
    if (!answer) throw new Error(`readPage asked ${step} unexpectedly`);
    return answer;
  };
  spies.push(
    spyOn(client, "askFetcher").mockImplementation(async (path: string) => next((answers as any)[path], path)),
    spyOn(jina, "fetchApiWithJina").mockImplementation(async () => next(answers.jinaApi, "jina api")),
    spyOn(jina, "fetchWithJinaReader").mockImplementation(async () => next(answers.jinaPage, "jina page")),
  );
}

const ciVariable = process.env.GITHUB_ACTIONS;
beforeEach(() => {
  steps = [];
  delete process.env.GITHUB_ACTIONS;
});
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  if (ciVariable !== undefined) process.env.GITHUB_ACTIONS = ciVariable;
});

describe("readPage", () => {
  test("a forum post behind a bot check goes plain request, then headless browser, then Jina, and never reaches the ladder", async () => {
    fake({ [FETCH_API_PATH]: [{ type: "bot_check" }], [FETCH_API_IN_BROWSER_PATH]: [{ type: "bot_check" }], jinaApi: [FORUM_POST_ANSWER] });
    const read = await readPage(FORUM_POST);
    expect(steps).toEqual([FETCH_API_PATH, FETCH_API_IN_BROWSER_PATH, "jina api"]);
    expect(read).toMatchObject({ type: "page", page: { title: "Generalized atheism", text: "The post's body.", authorName: "Eliezer Yudkowsky", source: { kind: "forum", authorFeedUrl: "https://www.lesswrong.com/users/eliezer_yudkowsky" } } });
  });

  test("a forum post that the browser could read stops there", async () => {
    fake({ [FETCH_API_PATH]: [{ type: "bot_check" }], [FETCH_API_IN_BROWSER_PATH]: [FORUM_POST_ANSWER] });
    expect((await readPage(FORUM_POST)).type).toBe("page");
    expect(steps).toEqual([FETCH_API_PATH, FETCH_API_IN_BROWSER_PATH]);
  });

  test("a shortform page ends at the API, because its web page has no text either", async () => {
    fake({ [FETCH_API_PATH]: [forumAnswer({ _id: "x", shortform: true })] });
    expect(await readPage(FORUM_POST)).toEqual({ type: "shortform" });
    expect(steps).toEqual([FETCH_API_PATH]);
  });

  test("a forum post the API does not give goes on to the ladder, and then to Jina", async () => {
    fake({ [FETCH_API_PATH]: [{ type: "failed", reason: "HTTP 500" }], [FETCH_PAGE_PATH]: [LADDER_FAILED], jinaPage: [{ type: "page", markdown: ARTICLE }] });
    const read = await readPage(FORUM_POST);
    expect(steps).toEqual([FETCH_API_PATH, FETCH_PAGE_PATH, "jina page"]);
    expect(read).toMatchObject({ type: "page", page: { url: FORUM_POST, title: "The title", source: { kind: "jina" } } });
  });

  test("a Substack post on its own domain comes from the post endpoint", async () => {
    fake({ [FETCH_API_PATH]: [SUBSTACK_ANSWER] });
    expect(await readPage(SUBSTACK_POST)).toMatchObject({ type: "page", page: { url: SUBSTACK_POST, title: "A big tent", text: "The post's body.", source: { kind: "substack" } } });
    expect(steps).toEqual([FETCH_API_PATH]);
  });

  test("an address of the shape /p/<slug> that is not Substack goes on to the ladder", async () => {
    fake({ [FETCH_API_PATH]: [{ type: "answer", body: "<html>not an API</html>" }], [FETCH_PAGE_PATH]: [LADDER_PAGE] });
    expect(await readPage(SUBSTACK_POST)).toMatchObject({ type: "page", page: { source: { kind: "ladder" } } });
    expect(steps).toEqual([FETCH_API_PATH, FETCH_PAGE_PATH]);
  });

  test("any other page goes straight to the ladder, and Jina is not asked when the ladder read it", async () => {
    fake({ [FETCH_PAGE_PATH]: [LADDER_PAGE] });
    expect(await readPage(PLAIN_PAGE)).toMatchObject({ type: "page", page: { title: "The title", source: { kind: "ladder", via: null } } });
    expect(steps).toEqual([FETCH_PAGE_PATH]);
  });

  test("when Jina cannot read the page either, the ladder's reason stays in the answer", async () => {
    fake({ [FETCH_PAGE_PATH]: [LADDER_FAILED], jinaPage: [{ type: "challenge" }] });
    expect(await readPage(PLAIN_PAGE)).toEqual({ type: "unreadable", reason: "HTTP 403 (last attempt: browser); Jina Reader: a bot check" });
    expect(steps).toEqual([FETCH_PAGE_PATH, "jina page"]);
  });
});
