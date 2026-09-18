import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { hideProxyAddress, withResidentialProxy } from "./residentialProxy";

const PROXY = "http://user:pass@proxy.example:823";

describe("withResidentialProxy", () => {
  const saved = process.env.YTDLP_PROXY_URL;
  let warn: ReturnType<typeof spyOn<Console, "warn">>;
  beforeEach(() => { warn = spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => {
    warn.mockRestore();
    if (saved === undefined) delete process.env.YTDLP_PROXY_URL;
    else process.env.YTDLP_PROXY_URL = saved;
  });

  test("retries a failed attempt on a fresh connection and returns the first success", async () => {
    process.env.YTDLP_PROXY_URL = PROXY;
    const attempt = mock(async (proxy: string | undefined) => {
      if (attempt.mock.calls.length < 3) throw new Error("socket closed");
      return proxy;
    });
    expect(await withResidentialProxy("https://example.com", attempt)).toBe(PROXY);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("throws the last error after three failed attempts", async () => {
    process.env.YTDLP_PROXY_URL = PROXY;
    const attempt = mock(async () => { throw new Error(`failure ${attempt.mock.calls.length}`); });
    await expect(withResidentialProxy("https://example.com", attempt)).rejects.toThrow("failure 3");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  test("does not retry an error the caller calls final", async () => {
    process.env.YTDLP_PROXY_URL = PROXY;
    const attempt = mock(async () => { throw new Error("404"); });
    await expect(withResidentialProxy("https://example.com", attempt, () => false)).rejects.toThrow("404");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test("without a proxy, connects directly and tries once", async () => {
    delete process.env.YTDLP_PROXY_URL;
    const attempt = mock(async (_proxy: string | undefined) => { throw new Error("refused"); });
    await expect(withResidentialProxy("https://example.com", attempt)).rejects.toThrow("refused");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0]![0]).toBeUndefined();
  });
});

describe("the proxy address", () => {
  test("is read only by residentialProxy.ts, so every proxied request gets the retries", () => {
    const srcDir = join(import.meta.dir, "../..");
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && !entry.name.startsWith("scripts_")) walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && entry.name !== "residentialProxy.ts") {
          if (readFileSync(full, "utf8").includes("process.env.YTDLP_PROXY_URL")) readers.push(full);
        }
      }
    };
    walk(srcDir);
    expect(readers).toEqual([]);
  });
});

describe("hideProxyAddress", () => {
  const saved = process.env.YTDLP_PROXY_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.YTDLP_PROXY_URL;
    else process.env.YTDLP_PROXY_URL = saved;
  });

  test("replaces the proxy's address, credentials included, with a placeholder", () => {
    process.env.YTDLP_PROXY_URL = PROXY;
    expect(hideProxyAddress(`Command failed: yt-dlp --proxy ${PROXY} --skip-download`))
      .toBe("Command failed: yt-dlp --proxy <residential proxy> --skip-download");
  });

  test("leaves text alone when no proxy is configured", () => {
    delete process.env.YTDLP_PROXY_URL;
    expect(hideProxyAddress("Command failed")).toBe("Command failed");
  });
});
