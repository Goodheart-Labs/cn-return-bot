import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchJson, fetchWebPage, fetchWebPageHtml, fetchWebPageInProcess } from "../../pipeline/tool-calling/tools";
import { callFetchService } from "../client";
import { FETCH_IMAGE_PATH, FETCH_SERVICE_SOCKET_VARIABLE, type FetchedImage } from "../contract";
import { startFetchService } from "./main";

// The ladder classifies anything shorter than a few hundred characters as too
// thin, so the test article is long enough to count as a real page.
const ARTICLE_TEXT = "The fetcher returned this article. ".repeat(20);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("the fetcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "cn-fetch-test-"));
  const socket = join(dir, "fetch.sock");
  let fetcher: ReturnType<typeof startFetchService>;
  let site: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    fetcher = startFetchService(socket);
    site = Bun.serve({
      port: 0,
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/image.png") return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
        if (pathname === "/post.json") return Response.json({ title: "A post" });
        return new Response(`<html><body><article><h1>Test</h1><p>${ARTICLE_TEXT}</p></article></body></html>`, {
          headers: { "content-type": "text/html" },
        });
      },
    });
  });

  afterAll(() => {
    fetcher.stop(true);
    site.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("fetchWebPage goes through the fetcher when the socket is set", async () => {
    process.env[FETCH_SERVICE_SOCKET_VARIABLE] = socket;
    try {
      const result = await fetchWebPage(`http://127.0.0.1:${site.port}/article`);
      expect(result.ok).toBe(true);
      expect(result.content).toContain("The fetcher returned this article.");
    } finally {
      delete process.env[FETCH_SERVICE_SOCKET_VARIABLE];
    }
  });

  test("fetchWebPageHtml and fetchJson go through the fetcher when the socket is set", async () => {
    process.env[FETCH_SERVICE_SOCKET_VARIABLE] = socket;
    try {
      const page = await fetchWebPageHtml(`http://127.0.0.1:${site.port}/article`);
      expect(page.ok && page.html).toContain("<article><h1>Test</h1>");
      expect(await fetchJson(`http://127.0.0.1:${site.port}/post.json`)).toEqual({ ok: true, json: { title: "A post" } });
      expect(await fetchJson(`http://127.0.0.1:${site.port}/article`)).toEqual({ ok: false, reason: "not JSON but text/html" });
    } finally {
      delete process.env[FETCH_SERVICE_SOCKET_VARIABLE];
    }
  });

  test("answers an image with its media type and base64 bytes", async () => {
    const image = await callFetchService<FetchedImage>(socket, FETCH_IMAGE_PATH, { url: `http://127.0.0.1:${site.port}/image.png` });
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data, "base64")).toEqual(Buffer.from(PNG_BYTES));
  });

  test("a failed image download comes back as an error the caller sees", async () => {
    await expect(callFetchService(socket, FETCH_IMAGE_PATH, { url: "file:///etc/hostname" })).rejects.toThrow(/not an http or https address/);
  });

  test("an unknown path is refused", async () => {
    await expect(callFetchService(socket, "/read-file", { path: "/etc/hostname" })).rejects.toThrow(/No such route/);
  });
});

describe("fetchWebPageInProcess", () => {
  test("refuses an address that is not http or https", async () => {
    const result = await fetchWebPageInProcess("file:///etc/hostname");
    expect(result.ok).toBe(false);
    expect(result.content).toStartWith("Fetch refused:");
  });
});
