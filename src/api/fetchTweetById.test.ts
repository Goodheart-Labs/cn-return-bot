import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import axios, { AxiosError } from "axios";
import * as oauth from "./getOAuthToken";
import { fetchTweetById, TweetLookupError } from "./fetchTweetById";

const tweetId = "2099621874279817638";
const tweet = { id: tweetId, text: "The original post.", author_id: "42", created_at: "2026-09-15T12:00:00Z" };
let get: ReturnType<typeof spyOn<typeof axios, "get">>;
let headers: ReturnType<typeof spyOn<typeof oauth, "getOAuth1Headers">>;

beforeEach(() => {
  get = spyOn(axios, "get").mockRejectedValue(new Error("Unexpected HTTP request"));
  headers = spyOn(oauth, "getOAuth1Headers").mockReturnValue({ Authorization: "OAuth test" });
});

afterEach(() => {
  get.mockRestore();
  headers.mockRestore();
});

async function lookupError(): Promise<TweetLookupError> {
  try {
    await fetchTweetById(tweetId);
  } catch (error) {
    expect(error).toBeInstanceOf(TweetLookupError);
    return error as TweetLookupError;
  }
  throw new Error("Expected the lookup to fail");
}

describe("single tweet lookup", () => {
  test("retrieves the requested tweet with supported fields and preserves its full text", async () => {
    get.mockResolvedValue({ data: { data: { ...tweet, note_tweet: { text: "The complete long post." } } } });

    const post = await fetchTweetById(tweetId);

    expect(post).toMatchObject({ id: tweetId, text: "The complete long post.", media: [] });
    expect(post.raw?.text).toBe(tweet.text);
    expect(get).toHaveBeenCalledTimes(1);
    const [url, config] = get.mock.calls[0]!;
    expect(new URL(url).pathname).toBe(`/2/tweets/${tweetId}`);
    const fields = new URL(url).searchParams.get("tweet.fields")!.split(",");
    expect(fields).toContain("note_tweet");
    expect(fields).not.toContain("matched_media_notes");
    expect(fields).not.toContain("note_request_suggestions");
    expect(config).toMatchObject({ timeout: 30_000, headers: { Authorization: "OAuth test" } });
    expect(headers).toHaveBeenCalledWith(url, "GET", undefined, "reader");
  });

  test("provides HTTP metadata while preserving X's response in the diagnostic message", async () => {
    const body = { detail: "Private diagnostic from X" };
    get.mockRejectedValue(Object.assign(new AxiosError("Request failed", "ERR_BAD_REQUEST"), {
      response: { status: 403, data: body },
    }));

    const error = await lookupError();

    expect(error.kind).toBe("http");
    expect(error.status).toBe(403);
    expect(error.message).toBe(`X API 403 fetching tweet ${tweetId}: ${JSON.stringify(body)}`);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test.each([
    { responseReason: "client-not-enrolled", expected: "client-not-enrolled" },
    { responseReason: "Private diagnostic from X", expected: undefined },
  ] as const)("exposes only recognized HTTP reason codes: $responseReason", async ({ responseReason, expected }) => {
    get.mockRejectedValue(Object.assign(new AxiosError("Request failed", "ERR_BAD_REQUEST"), {
      response: { status: 403, data: { reason: responseReason } },
    }));

    const error = await lookupError();

    expect(error.kind).toBe("http");
    expect(error.status).toBe(403);
    expect(error.reason).toBe(expected);
  });

  test.each(["ECONNABORTED", "ETIMEDOUT"])("classifies %s as a timeout without retrying", async (code) => {
    get.mockRejectedValue(new AxiosError("Request timed out", code));

    const error = await lookupError();

    expect(error.kind).toBe("timeout");
    expect(error.status).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("classifies a connection failure separately from an HTTP rejection", async () => {
    get.mockRejectedValue(new AxiosError("Connection reset", "ECONNRESET"));

    const error = await lookupError();

    expect(error.kind).toBe("network");
    expect(error.status).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test.each([{}, { data: null }, { errors: [{ detail: "Post unavailable" }] }])(
    "classifies a response with no post as unavailable: %j", async (data) => {
      get.mockResolvedValue({ data });

      expect((await lookupError()).kind).toBe("unavailable");
    },
  );

  test.each([
    { label: "plain text", data: "not JSON" },
    { label: "null envelope", data: null },
    { label: "array envelope", data: [] },
    { label: "array tweet", data: { data: [] } },
    { label: "string tweet", data: { data: "invalid" } },
    { label: "different tweet ID", data: { data: { ...tweet, id: "a different post" } } },
    { label: "missing text", data: { data: { id: tweetId } } },
    { label: "invalid long text", data: { data: { ...tweet, note_tweet: { text: 42 } } } },
    { label: "unparseable annotations", data: { data: { ...tweet, context_annotations: "not an array" } } },
  ])("classifies malformed or unparseable response data: $label", async ({ data }) => {
    get.mockResolvedValue({ data });

    expect((await lookupError()).kind).toBe("invalid_response");
  });

  test("classifies an Axios response parsing error as invalid_response", async () => {
    get.mockRejectedValue(new AxiosError("Invalid JSON", "ERR_BAD_RESPONSE"));

    expect((await lookupError()).kind).toBe("invalid_response");
  });
});
