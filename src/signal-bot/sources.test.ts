import { afterEach, describe, expect, spyOn, test } from "bun:test";
import axios from "axios";
import { discussionSourceUrls, isPublicSourceUrl, readDiscussionSource } from "./sources";

describe("Signal discussion source fetching", () => {
  let get: ReturnType<typeof spyOn<typeof axios, "get">> | undefined;
  afterEach(() => get?.mockRestore());

  test("only public web links qualify; pasted links are deduplicated and bounded", () => {
    for (const url of ["http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/", "file:///etc/passwd",
      "https://localhost/x", "http://[::1]/", "https://user:secret@example.org/x", "https://example.org:8080/x"]) {
      expect(isPublicSourceUrl(url)).toBe(false);
    }
    expect(discussionSourceUrls("Read https://example.org/a, https://example.org/a then https://example.org/b https://example.org/c https://example.org/d"))
      .toEqual(["https://example.org/a", "https://example.org/b", "https://example.org/c"]);
  });

  test("a redirect to a private destination is rejected without making the second request", async () => {
    get = spyOn(axios, "get").mockResolvedValue({ status: 302, headers: { location: "http://127.0.0.1/secrets" } });
    const result = await readDiscussionSource("https://8.8.8.8/article");
    expect(result.ok).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![1]?.maxRedirects).toBe(0);
    expect(get.mock.calls[0]![1]?.proxy).toBe(false);
  });

  test("readable source text is bounded and failed HTTP responses are not evidence", async () => {
    get = spyOn(axios, "get").mockResolvedValueOnce({
      status: 200, headers: { "content-type": "text/plain" }, data: Buffer.from("primary evidence ".repeat(2_000)),
    }).mockResolvedValueOnce({ status: 403, headers: {}, data: Buffer.from("Access denied") });
    const read = await readDiscussionSource("https://8.8.8.8/article");
    expect(read.ok).toBe(true);
    expect(read.content.length).toBe(12_000);
    const failed = await readDiscussionSource("https://8.8.8.8/article");
    expect(failed.ok).toBe(false);
    expect(failed.content).toContain("HTTP 403");
  });
});
