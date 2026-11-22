import { describe, expect, test } from "bun:test";
import { imageLinksIn, screenImages } from "./imageScreen";

describe("imageLinksIn", () => {
  test("finds the image links of a tweet's input", () => {
    const input = "Some tweet\n\n## Images on the post\n\nhttps://pbs.twimg.com/media/GabcDEF?format=jpg&name=large\nhttps://pbs.twimg.com/media/Gxyz.png";
    expect(imageLinksIn(input)).toEqual(["https://pbs.twimg.com/media/GabcDEF?format=jpg&name=large", "https://pbs.twimg.com/media/Gxyz.png"]);
  });

  test("finds images in a post's markdown and ignores ordinary links", () => {
    const post = "See [the paper](https://arxiv.org/abs/2401.1) and ![chart](https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fx.png) or https://example.com/a/photo.JPEG?v=2 here.";
    expect(imageLinksIn(post)).toEqual(["https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fx.png", "https://example.com/a/photo.JPEG?v=2"]);
  });

  test("lists each image once", () => {
    expect(imageLinksIn("https://a.org/x.gif https://a.org/x.gif")).toEqual(["https://a.org/x.gif"]);
  });
});

describe("screenImages", () => {
  const realFetch = globalThis.fetch;
  /** One image link; the image host answers with a PNG, and each service with what the test says. */
  function fakeNetwork(answers: { arachnid: unknown; arachnidStatus?: number; openai?: unknown }) {
    process.env.ARACHNID_SHIELD_USERNAME = "user";
    process.env.ARACHNID_SHIELD_PASSWORD = "password";
    process.env.OPENAI_API_KEY = "key";
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://shield.projectarachnid.com")) return Response.json(answers.arachnid, { status: answers.arachnidStatus ?? 200 });
      if (url.startsWith("https://api.openai.com")) return Response.json(answers.openai);
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    return calls;
  }
  const text = "A post with https://example.com/photo.png in it";
  const noMatch = { classification: "no-known-match", match_type: null };
  const sexual = (score: number) => ({ results: [{ category_scores: { sexual: score } }] });

  test("a known image on Arachnid's list stops the job before OpenAI sees it", async () => {
    const calls = fakeNetwork({ arachnid: { classification: "csam", match_type: "near" } });
    expect(await screenImages(text)).toEqual({ kind: "flagged", reason: "Arachnid Shield: csam (near match)" });
    expect(calls.some((url) => url.includes("openai"))).toBe(false);
    globalThis.fetch = realFetch;
  });

  test("an image OpenAI scores as sexual stops the job", async () => {
    fakeNetwork({ arachnid: noMatch, openai: sexual(0.4) });
    expect(await screenImages(text)).toEqual({ kind: "flagged", reason: "OpenAI moderation: sexual score 0.40" });
    globalThis.fetch = realFetch;
  });

  test("an image both checks pass is clear", async () => {
    fakeNetwork({ arachnid: noMatch, openai: sexual(0.01) });
    expect(await screenImages(text)).toEqual({ kind: "clear", screened: 1, passedOver: 0 });
    globalThis.fetch = realFetch;
  });

  test("a host without the Arachnid login screens nothing and calls no service", async () => {
    const calls = fakeNetwork({ arachnid: noMatch, openai: sexual(0.9) });
    delete process.env.ARACHNID_SHIELD_USERNAME;
    expect(await screenImages(text)).toEqual({ kind: "off" });
    expect(calls).toEqual([]);
    globalThis.fetch = realFetch;
  });

  test("a failing Arachnid stops the job instead of letting it through", async () => {
    fakeNetwork({ arachnid: { detail: "down" }, arachnidStatus: 503 });
    await expect(screenImages(text)).rejects.toThrow("Arachnid Shield answered 503");
    globalThis.fetch = realFetch;
  });
});
