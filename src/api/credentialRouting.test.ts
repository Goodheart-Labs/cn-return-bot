import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import axios from "axios";
import { fetchTweetById } from "./fetchTweetById";
import { getOAuth1Headers } from "./getOAuthToken";
import { submitNote } from "./submitNote";

const suffixes = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"] as const;
const envNames = ["X", "X_READ", "X_JIMMAAR1"].flatMap((prefix) => suffixes.map((suffix) => `${prefix}_${suffix}`));
const tweetId = "2099621874279817638";
const info = { classification: "MISINFORMED_OR_POTENTIALLY_MISLEADING", misleading_tags: [], text: "An approved note.", trustworthy_sources: true };
let originalEnv: Map<string, string | undefined>;
let get: ReturnType<typeof spyOn<typeof axios, "get">>;
let post: ReturnType<typeof spyOn<typeof axios, "post">>;

function configure(prefix: string, label: string): void {
  for (const suffix of suffixes) process.env[`${prefix}_${suffix}`] = `${label}-${suffix.toLowerCase()}`;
}

function expectAccount(header: unknown, label: string): void {
  expect(header).toContain(`oauth_consumer_key="${label}-api_key"`);
  expect(header).toContain(`oauth_token="${label}-access_token"`);
}

beforeEach(() => {
  originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  configure("X", "writer");
  get = spyOn(axios, "get").mockResolvedValue({ data: { data: { id: tweetId, text: "Original tweet.", author_id: "42", created_at: "2026-09-16T12:00:00Z" } } });
  post = spyOn(axios, "post").mockResolvedValue({ data: { data: { id: "mock-note" } } });
});

afterEach(() => {
  get.mockRestore();
  post.mockRestore();
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("X reader and writer credentials", () => {
  test("the signer defaults to writer credentials even with a configured reader", () => {
    configure("X_READ", "reader");
    expectAccount(getOAuth1Headers("https://api.x.com/2/tweets/123").Authorization, "writer");
    expectAccount(getOAuth1Headers("https://api.x.com/2/notes", "POST", "{}").Authorization, "writer");
  });

  test("concurrent tweet lookup and note submission use separate accounts without changing the environment", async () => {
    configure("X_READ", "reader");
    const before = envNames.map((name) => [name, process.env[name]]);
    const [tweet] = await Promise.all([fetchTweetById(tweetId), submitNote(tweetId, info)]);
    expect(tweet.id).toBe(tweetId);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expectAccount(get.mock.calls[0]![1]?.headers?.Authorization, "reader");
    expectAccount(post.mock.calls[0]![2]?.headers?.Authorization, "writer");
    expect(post.mock.calls[0]![0]).toBe("https://api.x.com/2/notes");
    expect(envNames.map((name) => [name, process.env[name]])).toEqual(before);
  });

  test("missing reader credentials preserve the standard account without discovering saved alternate accounts", async () => {
    configure("X_JIMMAAR1", "alternate");
    await fetchTweetById(tweetId);
    expectAccount(get.mock.calls[0]![1]?.headers?.Authorization, "writer");
  });

  test("an entirely empty optional reader set also preserves the standard account", async () => {
    for (const suffix of suffixes) process.env[`X_READ_${suffix}`] = "";
    await fetchTweetById(tweetId);
    expectAccount(get.mock.calls[0]![1]?.headers?.Authorization, "writer");
  });

  test.each([...suffixes])("a missing reader %s fails before HTTP and cannot borrow writer credentials", async (suffix) => {
    configure("X_READ", "reader");
    delete process.env[`X_READ_${suffix}`];
    await expect(fetchTweetById(tweetId)).rejects.toThrow(`Missing required environment variable: X_READ_${suffix}`);
    expect(get).not.toHaveBeenCalled();
    await submitNote(tweetId, info);
    expectAccount(post.mock.calls[0]![2]?.headers?.Authorization, "writer");
  });

  test("a complete reader works without writer credentials but cannot authorize a submission", async () => {
    configure("X_READ", "reader");
    for (const suffix of suffixes) delete process.env[`X_${suffix}`];
    await fetchTweetById(tweetId);
    expectAccount(get.mock.calls[0]![1]?.headers?.Authorization, "reader");
    await expect(submitNote(tweetId, info)).rejects.toThrow("Missing required environment variable: X_API_KEY");
    expect(post).not.toHaveBeenCalled();
  });
});
