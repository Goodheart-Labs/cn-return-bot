import { afterEach, beforeEach, expect, test } from "bun:test";
import { fetchTweetComments } from "./comments";

const originalKey = process.env.XAI_API_KEY;
beforeEach(() => {
  process.env.XAI_API_KEY = "not-a-real-key";
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = originalKey;
});

test("asks for no comments on a claim from an article or a video, so none are invented", async () => {
  expect(await fetchTweetComments("3a030aad-0", "Some claim")).toBe("");
});
