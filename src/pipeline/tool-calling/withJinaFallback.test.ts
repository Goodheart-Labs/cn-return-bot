import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import * as jina from "./jinaReader";
import { withJinaFallback } from "./tools";

const failed = { content: "Fetch failed: HTTP 403 (last attempt: browser)", fetchedUrl: "https://example.com/a", ok: false };
const article = `# A real article\n\n${"The article text goes on for a while. ".repeat(40)}`;

describe("withJinaFallback", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));
  const answer = (result: jina.JinaReaderResult) => {
    const spy = spyOn(jina, "fetchWithJinaReader").mockResolvedValue(result);
    spies.push(spy);
    return spy;
  };

  test("a run that is not on the jina_fetch arm keeps the failure and never calls Jina", async () => {
    const spy = answer({ type: "page", markdown: article });
    expect(await withBotConfig({ ...DEFAULT_CONFIG, jina_fetch: false }, () => withJinaFallback(failed.fetchedUrl, failed))).toEqual(failed);
    expect(await withJinaFallback(failed.fetchedUrl, failed)).toEqual(failed);
    expect(spy).not.toHaveBeenCalled();
  });

  test("a page that the free ladder read never reaches Jina", async () => {
    const spy = answer({ type: "page", markdown: article });
    const ok = { content: article, fetchedUrl: failed.fetchedUrl, ok: true };
    expect(await withBotConfig({ ...DEFAULT_CONFIG, jina_fetch: true }, () => withJinaFallback(failed.fetchedUrl, ok))).toEqual(ok);
    expect(spy).not.toHaveBeenCalled();
  });

  test("on the arm, a page that the ladder failed on is read through Jina and cited at its own address", async () => {
    answer({ type: "page", markdown: article });
    const result = await withBotConfig({ ...DEFAULT_CONFIG, jina_fetch: true }, () => withJinaFallback(failed.fetchedUrl, failed));
    expect(result.ok).toBe(true);
    expect(result.fetchedUrl).toBe(failed.fetchedUrl);
    expect(result.content.startsWith("[fetched via Jina Reader]")).toBe(true);
  });

  test("when Jina cannot read the page either, the ladder's own diagnostic stays", async () => {
    for (const result of [{ type: "challenge" }, { type: "target_error", status: 404 }, { type: "page", markdown: "Just a moment..." }] as jina.JinaReaderResult[]) {
      answer(result);
      expect(await withBotConfig({ ...DEFAULT_CONFIG, jina_fetch: true }, () => withJinaFallback(failed.fetchedUrl, failed))).toEqual(failed);
      spies.splice(0).forEach((s) => s.mockRestore());
    }
  });
});
