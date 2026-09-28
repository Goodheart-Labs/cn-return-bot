import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchWebPage } from "../tool-calling/tools";
import { NonPublicUrlError, assertPublicUrl, fetchPublicUrl } from "./publicUrl";

// IP literals keep these tests off the network: a literal is checked without
// a DNS lookup. 1.1.1.1 and 8.8.8.8 stand in for any public server.
const PUBLIC_PAGE = "http://1.1.1.1/article";

describe("assertPublicUrl", () => {
  test.each([
    "file:///etc/passwd",
    "ftp://1.1.1.1/file.txt",
    "http://127.0.0.1:8787/health",
    "http://localhost:4416/ping",
    "http://169.254.169.254/latest",
    "http://10.0.0.5/",
    "http://172.16.3.4/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    // The URL parser reads these as 127.0.0.1, so they must be refused too.
    "http://2130706433/",
    "http://0x7f.1/",
  ])("refuses %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(NonPublicUrlError);
  });

  test.each(["http://1.1.1.1/", "https://8.8.8.8/dns", "http://[2606:4700:4700::1111]/"])("accepts %s", async (url) => {
    await expect(assertPublicUrl(url)).resolves.toBeUndefined();
  });
});

describe("fetchPublicUrl", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
  afterEach(() => fetchSpy?.mockRestore());

  function answerWith(responses: Record<string, Response>) {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const response = responses[String(input)];
      if (!response) throw new Error(`unexpected fetch of ${input}`);
      return response;
    }) as typeof fetch);
  }

  test("refuses a public page that redirects to an internal address", async () => {
    answerWith({ [PUBLIC_PAGE]: new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) });
    await expect(fetchPublicUrl(PUBLIC_PAGE)).rejects.toBeInstanceOf(NonPublicUrlError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("follows a redirect to another public address and reports where it ended", async () => {
    answerWith({
      [PUBLIC_PAGE]: new Response(null, { status: 301, headers: { location: "/moved" } }),
      "http://1.1.1.1/moved": new Response("the article", { status: 200 }),
    });
    const { response, finalUrl } = await fetchPublicUrl(PUBLIC_PAGE);
    expect(finalUrl).toBe("http://1.1.1.1/moved");
    expect(await response.text()).toBe("the article");
  });
});

describe("fetchWebPage", () => {
  test("refuses an internal address without sending any request", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const result = await fetchWebPage("http://169.254.169.254/hetzner/v1/metadata");
      expect(result.ok).toBe(false);
      expect(result.content).toStartWith("Fetch refused:");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
