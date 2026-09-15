import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchSearchResults } from "./serper";

const savedKey = process.env.SERPER_API_KEY;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
afterEach(() => {
  fetchSpy?.mockRestore();
  if (savedKey === undefined) delete process.env.SERPER_API_KEY;
  else process.env.SERPER_API_KEY = savedKey;
});

describe("Serper cancellation", () => {
  test("aborting after headers cancels a stalled response body", async () => {
    process.env.SERPER_API_KEY = "test";
    const controller = new AbortController();
    const nativeFetch = globalThis.fetch;
    let receivedHeaders!: () => void;
    const headers = new Promise<void>(resolve => { receivedHeaders = resolve; });
    let bodyCancelled = false;
    let trickle: ReturnType<typeof setInterval> | undefined;
    const server = Bun.serve({
      port: 0,
      fetch() {
        const body = new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(" "));
            trickle = setInterval(() => stream.enqueue(new TextEncoder().encode(" ")), 20);
          },
          cancel() {
            bodyCancelled = true;
            clearInterval(trickle);
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: unknown, init?: RequestInit) => {
      const response = await nativeFetch(`http://localhost:${server.port}/search`, init);
      receivedHeaders();
      return response;
    }) as typeof globalThis.fetch) as typeof fetchSpy;
    const watchdog = setTimeout(() => controller.abort(new Error("test watchdog")), 1000);
    try {
      const result = fetchSearchResults("the claim", controller.signal);
      // Prove cancellation occurs during response.json(), after fetch resolves.
      await headers;
      await Bun.sleep(10);
      controller.abort(new Error("prefilter expired"));
      await expect(result).rejects.toThrow();
      await Bun.sleep(20);
      expect(bodyCancelled).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(watchdog);
      clearInterval(trickle);
      server.stop(true);
    }
  });

  test("aborting during backoff prevents another search request", async () => {
    process.env.SERPER_API_KEY = "test";
    const controller = new AbortController();
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503 })) as typeof fetchSpy;
    const timer = setTimeout(() => controller.abort(new Error("prefilter expired")), 30);
    try {
      await expect(fetchSearchResults("the claim", controller.signal)).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally { clearTimeout(timer); }
  });

  test("an already cancelled gate never contacts search", async () => {
    process.env.SERPER_API_KEY = "test";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}")) as typeof fetchSpy;
    await expect(fetchSearchResults("the claim", AbortSignal.abort(new Error("expired")))).rejects.toThrow("expired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
