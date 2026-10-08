import { describe, expect, spyOn, test } from "bun:test";
import { articleChunk, chunkText, contextTimeSpan, describeArticleImages, renderImageDescriptions, runExtraction } from "./extractClaims";
import { claudeExtractionModels, withExtractionModels } from "./model";
import * as costTracker from "../../pipeline/cost-tracking/costTracker";
import * as gemini from "../../pipeline/media/mediaAnalysisGemini";
import type { SubtitleCue } from "../../pipeline/media/youtubeCaptions";

/** Cues shaped like the passage that surfaced the bug (GOO-52): the video
 *  https://www.youtube.com/watch?v=koKDP6kPvvY had a noted claim whose short
 *  context excerpt straddled a cue boundary, so no whole cue appeared inside
 *  it and the claim was saved without a timestamp. Without a timestamp the
 *  extension never pins the note on the player. */
const cues: SubtitleCue[] = [
  { start: 185, end: 193, text: "And then Dookie came out and Green Day found that perfect balance" },
  { start: 193, end: 198, text: "of having the edge still but being very mass appeal. And within what?" },
  { start: 198, end: 202, text: "3 years? Sum 41? You know? I'm not critiquing Sum 41 in particular," },
  { start: 202, end: 209, text: "but that kind of punk became like so mass appeal and so clean" },
];

describe("contextTimeSpan", () => {
  test("finds a short excerpt that straddles a cue boundary", () => {
    expect(contextTimeSpan("And within what? 3 years? Sum 41?", cues)).toEqual({ start: 193, end: 202 });
  });

  test("finds a short excerpt inside a single cue", () => {
    expect(contextTimeSpan("having the edge still", cues)).toEqual({ start: 193, end: 198 });
  });

  test("finds an excerpt spanning several whole cues", () => {
    const excerpt = cues.slice(0, 3).map((c) => c.text).join(" ");
    expect(contextTimeSpan(excerpt, cues)).toEqual({ start: 185, end: 202 });
  });

  test("ignores punctuation and casing differences", () => {
    expect(contextTimeSpan("and WITHIN what... 3 years — Sum 41", cues)).toEqual({ start: 193, end: 202 });
  });

  test("falls back to whole-cue matching when the excerpt has extra wording", () => {
    // An excerpt from an author's own transcript can contain a whole cue
    // verbatim while its surrounding words differ from the auto-captions.
    const excerpt = "He said: 3 years? Sum 41? You know? I'm not critiquing Sum 41 in particular, right?";
    expect(contextTimeSpan(excerpt, cues)).toEqual({ start: 198, end: 202 });
  });

  test("returns an empty span for text not in the transcript", () => {
    expect(contextTimeSpan("something entirely different was said here", cues)).toEqual({});
  });

  test("returns an empty span for an empty excerpt", () => {
    expect(contextTimeSpan("", cues)).toEqual({});
  });
});

describe("chunkText", () => {
  const paragraph = "word ".repeat(500).trim();

  test("keeps a short text in one chunk", () => {
    expect(chunkText("First paragraph.\n\nSecond paragraph.")).toEqual(["First paragraph.\n\nSecond paragraph."]);
  });

  test("starts a new chunk at a paragraph break once the size limit would be passed", () => {
    const text = Array.from({ length: 10 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12_000);
    expect(chunks.join("\n\n")).toBe(text);
  });
});

test("articleChunk labels a chunk as an article excerpt", () => {
  expect(articleChunk("Some text.")).toBe("Article excerpt:\n\nSome text.");
});

describe("renderImageDescriptions", () => {
  const url = "https://example.com/a.png";

  test("replaces the marker with the url, the description and the visible text", () => {
    const rendered = renderImageDescriptions(`Before [[IMAGE:${url}]] after`, new Map([[url, { description: "A chart.", ocrText: "Sales" }]]));
    expect(rendered).toBe(`Before [Image: ${url}\nDescription: A chart.\nVisible text: Sales] after`);
  });

  test("says so when an image could not be analyzed", () => {
    expect(renderImageDescriptions(`[[IMAGE:${url}]]`, new Map())).toBe(`[Image: ${url}\n(image could not be analyzed)]`);
  });
});

describe("describeArticleImages", () => {
  test("describes each distinct image once and keeps an empty description for a failed one", async () => {
    const spy = spyOn(gemini, "describeImageFromUrl").mockImplementation(async (url: string) => {
      if (url.endsWith("bad.png")) throw new Error("boom");
      return { description: { description: `of ${url}`, ocrText: "" } } as any;
    });
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const text = "[[IMAGE:https://x/a.png]] and again [[IMAGE:https://x/a.png]] and [[IMAGE:https://x/bad.png]]";
    const descriptions = await describeArticleImages(text);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(descriptions.get("https://x/a.png")?.description).toBe("of https://x/a.png");
    expect(descriptions.get("https://x/bad.png")).toEqual({ description: "", ocrText: "" });
    spy.mockRestore();
    quiet.mockRestore();
  });
});

describe("runExtraction", () => {
  test("sends the chunk to the model that extractionModels names and returns its claims", async () => {
    const claim = { claim: "A is true.", context: "A is true.", context_paragraph: "A is true.", image_urls: [], very_confident_that_its_true: false, speculation: false };
    const spy = spyOn(costTracker, "trackedLlmCreate").mockResolvedValue({
      response: { choices: [{ message: { content: JSON.stringify({ claims: [claim] }) } }] },
      costEntry: { name: "claim_extraction", input_tokens: 1, output_tokens: 1, cost: 0, tools: [] },
    } as any);
    const claims = await withExtractionModels(claudeExtractionModels("anthropic/claude-sonnet-5.5", "medium"), () => runExtraction("Article excerpt:\n\nA is true."));
    expect(claims).toEqual([claim]);
    const request = spy.mock.calls[0]![1] as any;
    expect(request.model).toBe("anthropic/claude-sonnet-5.5");
    expect(request.reasoning_effort).toBe("medium");
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "Article excerpt:\n\nA is true." });
    spy.mockRestore();
  });
});
