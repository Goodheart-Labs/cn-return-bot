import { describe, expect, spyOn, test } from "bun:test";
import { articleChunk, bodyOfChunkMessage, chunkText, contextTimeSpan, describeArticleImages, extractionSystemPrompt, renderImageDescriptions, runExtraction, runPassageExtraction } from "./extractClaims";
import { PASSAGE_TYPES } from "./passages";
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
  const message = "Article excerpt:\n\nA is true. B is a matter of taste.";
  const completion = (passages: object) => ({
    response: { choices: [{ message: { content: JSON.stringify(passages) } }] },
    costEntry: { name: "claim_extraction", input_tokens: 1, output_tokens: 1, cost: 0, tools: [] },
  });

  test("sends the chunk to the model that extractionModels names and returns the claims of its passages", async () => {
    const spy = spyOn(costTracker, "trackedLlmCreate").mockResolvedValue(
      completion({ "A is true.": { type: "statement", claims: ["A is true."] }, "B is a matter of taste.": { type: "other" } }) as any,
    );
    const claims = await withExtractionModels(claudeExtractionModels("anthropic/claude-sonnet-5.5", "medium"), () => runExtraction(message));
    expect(claims).toEqual([{ claim: "A is true.", context: "A is true.", contextParagraph: "A is true. B is a matter of taste.", imageUrls: [] }]);
    const request = spy.mock.calls[0]![1] as any;
    expect(request.model).toBe("anthropic/claude-sonnet-5.5");
    expect(request.reasoning_effort).toBe("medium");
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages.at(-1)).toEqual({ role: "user", content: message });
    spy.mockRestore();
  });

  test("tells the model which text its passages left out and asks again", async () => {
    const spy = spyOn(costTracker, "trackedLlmCreate")
      .mockResolvedValueOnce(completion({ "A is true.": { type: "statement", claims: ["A is true."] } }) as any)
      .mockResolvedValueOnce(completion({ "A is true.": { type: "statement", claims: ["A is true."] }, "B is a matter of taste.": { type: "other" } }) as any);
    const extraction = await runPassageExtraction(message);
    expect(extraction.attempts).toBe(2);
    expect(extraction.passages).toHaveLength(2);
    const retryMessages = (spy.mock.calls[1]![1] as any).messages;
    expect(retryMessages.at(-1).content).toContain("B is a matter of taste.");
    spy.mockRestore();
  });

  test("gives up when the passages never add up to the text", async () => {
    const spy = spyOn(costTracker, "trackedLlmCreate").mockResolvedValue(completion({ "A is true.": { type: "statement", claims: ["A is true."] } }) as any);
    await expect(runPassageExtraction(message)).rejects.toThrow("no acceptable answer after 3 attempts");
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  test("does not call the model for a chunk that holds only an image block", async () => {
    const spy = spyOn(costTracker, "trackedLlmCreate");
    const extraction = await runPassageExtraction("Article excerpt:\n\n[Image: https://x/a.png\nDescription: A chart.]");
    expect(extraction.passages).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("bodyOfChunkMessage", () => {
  test("strips the label of an article chunk and of a transcript chunk", () => {
    expect(bodyOfChunkMessage("Article excerpt:\n\nText.")).toBe("Text.");
    expect(bodyOfChunkMessage("Transcript segment:\n\nSpeech.")).toBe("Speech.");
  });

  test("keeps only the part after the introduction", () => {
    expect(bodyOfChunkMessage("Introduction (context only):\n\nOpening.\n\nPart:\n\nArticle excerpt:\n\nText.")).toBe("Text.");
  });
});

describe("extractionSystemPrompt", () => {
  test("names every passage type and asks for the claims of a passage", () => {
    for (const type of PASSAGE_TYPES) expect(extractionSystemPrompt()).toContain(`"${type}"`);
    expect(extractionSystemPrompt()).toContain('"claims"');
  });

  test("adds the types an experiment asks for", () => {
    expect(extractionSystemPrompt({ other: "fits none of the above" })).toContain('- "other": fits none of the above');
  });
});
