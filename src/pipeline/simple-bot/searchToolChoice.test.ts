import { describe, expect, test } from "bun:test";
import { rejectsForcedToolCall } from "./searchDispatch";
import { isRetryableError } from "../llm/llm";

/** The exact body OpenRouter returned for Muse on 2026-09-08. The whole
 *  fallback hinges on reading this shape correctly, so it is pinned verbatim. */
function metaToolChoiceError() {
  const err: any = new Error("400 Provider returned error");
  err.status = 400;
  err.error = {
    message: "Provider returned error",
    code: 400,
    metadata: {
      provider_name: "Meta",
      raw: '{"error":{"code":null,"message":"only `\\"auto\\"` is supported for `tool_choice`. `\\"none\\"`, `\\"required\\"`, and named function choices are not currently supported","param":"tool_choice","type":"invalid_request_error"}}',
    },
  };
  return err;
}

/** A provider that fell over rather than refusing the request. */
function providerOutageError() {
  const err: any = new Error("400 Provider returned error");
  err.status = 400;
  err.error = {
    message: "Provider returned error",
    code: 400,
    metadata: { provider_name: "Meta", raw: '{"error":{"message":"upstream timeout","type":"server_error"}}' },
  };
  return err;
}

describe("rejectsForcedToolCall", () => {
  test("recognises Meta refusing tool_choice", () => {
    expect(rejectsForcedToolCall(metaToolChoiceError())).toBe(true);
  });

  test("ignores a provider outage, which is worth retrying as it is", () => {
    expect(rejectsForcedToolCall(providerOutageError())).toBe(false);
  });

  test("ignores errors that are not a 400", () => {
    const err: any = new Error("429 rate limited");
    err.status = 429;
    err.error = { metadata: { raw: "tool_choice" } };
    expect(rejectsForcedToolCall(err)).toBe(false);
  });

  test("ignores an error carrying no provider body", () => {
    const err: any = new Error("400 Bad Request");
    err.status = 400;
    expect(rejectsForcedToolCall(err)).toBe(false);
  });
});

describe("isRetryableError", () => {
  test("does not retry a request the provider called invalid", () => {
    // Retrying an identical request that was rejected on its merits can only
    // fail again, so it should reach the caller straight away.
    expect(isRetryableError(metaToolChoiceError())).toBe(false);
  });

  test("still retries a provider outage", () => {
    expect(isRetryableError(providerOutageError())).toBe(true);
  });

  test("still retries the usual transient status codes", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const err: any = new Error(`${status}`);
      err.status = status;
      expect(isRetryableError(err)).toBe(true);
    }
  });
});
