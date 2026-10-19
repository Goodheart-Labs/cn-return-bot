import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { TweetLookupError } from "../api/fetchTweetById";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import {
  createDraftingAdapter, validateSignalDraft, type DraftingDependencies, type SignalDraft,
} from "./drafting";

const post: Post = {
  id: "1234567890123456789", text: "A factual claim to check.",
  author_id: "42", created_at: "2026-09-12T12:00:00Z", media: [],
};
const draft: SignalDraft = { text: "The official record gives a different date.", sources: ["https://example.org/record"] };

function dependencies(overrides: Partial<DraftingDependencies> = {}): DraftingDependencies {
  return {
    fetchPost: async () => post,
    initialDraft: async () => ({
      outcome: { type: "note", noteText: draft.text, sources: draft.sources, searchResults: "The record says 2017." },
      inputContext: "Original post and inspected media.",
    }),
    discuss: async () => ({ action: "discuss", reply: "The record is relevant to this claim.", draft: null, abstentionReason: null }),
    chat: async () => ({ reply: "Paste a tweet link and I will draft a note for it." }),
    readSource: async (url) => ({ url, ok: true, content: "The primary document gives the date as 2017." }),
    ...overrides,
  };
}

describe("Signal draft adapter", () => {
  test("the real default scope selects supported native search while honoring explicit overrides", async () => {
    const [input, pipeline, config] = await Promise.all([
      import("../pipeline/input/createBotInput"),
      import("../pipeline/simple-bot/orchestrator"),
      import("../pipeline/ab-testing/botConfig"),
    ]);
    const sharedBefore = structuredClone(config.DEFAULT_CONFIG);
    const observed: Array<{ web_search: string; search_model?: string }> = [];
    // Mock the API/LLM boundaries, while exercising the adapter's real lazy
    // imports and configuration scope. No credentials or services are used.
    const inputCall = spyOn(input, "createBotInput").mockResolvedValue({
      mediaResult: { tweetMedia: [], quotedTweetMedia: [] }, mediaMadeWithAiLabel: false,
    });
    const pipelineCall = spyOn(pipeline, "runSimpleBotPipeline").mockImplementation(async () => {
      const active = config.getBotConfig();
      observed.push({ web_search: active.web_search, search_model: active.search_model });
      return { type: "no_correction", reason: "Offline configuration test." };
    });
    try {
      await createDraftingAdapter().draft({ post, history: [] });
      await createDraftingAdapter({}, { web_search: "native_grok", search_model: "x-ai/grok-4.3" }).draft({ post, history: [] });
      expect(observed).toEqual([
        { web_search: "native", search_model: "anthropic/claude-sonnet-4.6" },
        { web_search: "native_grok", search_model: "x-ai/grok-4.3" },
      ]);
      expect(config.DEFAULT_CONFIG).toEqual(sharedBefore);
      expect(inputCall).toHaveBeenCalledTimes(2);
      expect(pipelineCall).toHaveBeenCalledTimes(2);
    } finally {
      inputCall.mockRestore();
      pipelineCall.mockRestore();
    }
  });

  test("the default inspection uses only the direct lookup even when the feed is unavailable", async () => {
    const lookup = await import("../api/fetchTweetById");
    const feed = await import("../api/fetchEligiblePosts");
    const lookupCall = spyOn(lookup, "fetchTweetById").mockResolvedValue(post);
    const feedCall = spyOn(feed, "fetchEligiblePosts").mockRejectedValue(new Error("Feed unavailable"));
    try {
      const result = await createDraftingAdapter().inspect(post.id);
      expect(lookupCall).toHaveBeenCalledWith(post.id);
      expect(lookupCall).toHaveBeenCalledTimes(1);
      expect(feedCall).not.toHaveBeenCalled();
      expect(result.access).toBe("readable");
      expect(result.eligibility).toBe("unconfirmed");
      expect(result.post).toEqual(post);
      expect(result.detail).toContain("after you approve a draft");
      expect(result.detail).not.toContain("feed");

      lookupCall.mockRejectedValue(new TweetLookupError("timeout", "private API response"));
      const failed = await createDraftingAdapter().inspect(post.id);
      expect(failed.access).toBe("unavailable");
      expect(failed.post).toBeUndefined();
      expect(failed.detail).toContain("timed out");
      expect(feedCall).not.toHaveBeenCalled();
    } finally {
      lookupCall.mockRestore();
      feedCall.mockRestore();
    }
  });

  test("lookup failure exposes neither API secrets nor a claim of ineligibility", async () => {
    const result = await createDraftingAdapter(dependencies({
      fetchPost: async () => { throw new Error("private API response"); },
    })).inspect(post.id);
    expect(result.access).toBe("unavailable");
    expect(result.eligibility).toBe("unconfirmed");
    expect(result.detail).toContain("failed unexpectedly");
    expect(JSON.stringify(result)).not.toContain("private API response");
  });

  test.each([
    { kind: "http", status: 400, expected: "HTTP 400" },
    { kind: "http", status: 401, expected: "authenticate" },
    { kind: "http", status: 403, expected: "denied" },
    { kind: "http", status: 404, expected: "find or provide" },
    { kind: "http", status: 429, expected: "rate-limited" },
    { kind: "http", status: 503, expected: "HTTP 503" },
    { kind: "timeout", status: undefined, expected: "timed out" },
    { kind: "network", status: undefined, expected: "could not connect" },
    { kind: "unavailable", status: undefined, expected: "no tweet data" },
    { kind: "invalid_response", status: undefined, expected: "could not read" },
  ] as const)("lookup failures identify $expected without sharing the raw error", async ({ kind, status, expected }) => {
    const result = await createDraftingAdapter(dependencies({
      fetchPost: async () => { throw new TweetLookupError(kind, "private API response", status); },
    })).inspect(post.id);
    expect(result.access).toBe("unavailable");
    expect(result.post).toBeUndefined();
    expect(result.detail).toContain(expected);
    expect(result.detail).toContain("research has not started");
    expect(result.detail).toContain("retry");
    expect(JSON.stringify(result)).not.toContain("private API response");
  });

  test("a client-not-enrolled response identifies the developer app configuration problem", async () => {
    const result = await createDraftingAdapter(dependencies({
      fetchPost: async () => { throw new TweetLookupError("http", "private API response", 403, "client-not-enrolled"); },
    })).inspect(post.id);
    expect(result.access).toBe("unavailable");
    expect(result.detail).toContain("developer app attached to an X Project");
    expect(result.detail).toContain("HTTP 403");
    expect(JSON.stringify(result)).not.toContain("private API response");
  });

  test("initial theoretical draft survives a failed verifier with a visible warning", async () => {
    const result = await createDraftingAdapter(dependencies({ initialDraft: async () => ({
      outcome: { type: "verification_failed", noteText: draft.text, sources: draft.sources, reason: "Only part of the claim is supported." },
      inputContext: "The tweet's inspected media context",
    }) })).draft({ post, history: [] });
    expect(result.draft).toEqual(draft);
    expect(result.reply).toContain("source check did not pass");
    expect(result.research).toContain("inspected media context");
    expect(result.abstentionReason).toBeUndefined();
  });

  test("initial no-correction decision abstains instead of manufacturing a note", async () => {
    const result = await createDraftingAdapter(dependencies({ initialDraft: async () => ({
      outcome: { type: "no_correction", reason: "The primary evidence supports the tweet." }, inputContext: "Tweet",
    }) })).draft({ post, history: [] });
    expect(result.draft).toBeUndefined();
    expect(result.abstentionReason).toContain("supports the tweet");
    expect(result.research).toBeDefined();
  });

  test("discussion and hypothetical revision questions cannot replace or withdraw the current draft", async () => {
    for (const message of ["Why did you pick this source?", "Should we rewrite this to include the date?"]) {
      for (const action of ["revise", "abstain"]) {
        const before = JSON.stringify(draft);
        const result = await createDraftingAdapter(dependencies({ discuss: async () => ({
          action, reply: "Discuss the evidence.", draft: { ...draft, text: "Changed by model" }, abstentionReason: "Model withdrew it",
        }) })).draft({ post, research: "Findings", currentDraft: draft, history: [{ role: "user", content: message }] });
        expect(result.draft).toBeUndefined();
        expect(result.abstentionReason).toBeUndefined();
        expect(JSON.stringify(draft)).toBe(before);
      }
    }
  });

  test("a requested rewrite reads supplied sources and returns a distinct replacement", async () => {
    const readSource = mock(async (url: string) => ({ url, ok: true, content: "Primary document: 2017." }));
    const discuss = mock(async () => ({ action: "revise", reply: "The source supports the date.",
      draft: { text: "This happened in 2017.", sources: ["https://example.org/new-source"] }, abstentionReason: null }));
    const result = await createDraftingAdapter(dependencies({ readSource, discuss })).draft({
      post, research: "Findings", currentDraft: draft,
      history: [{ role: "user", content: "Please rewrite it using this: https://example.org/new-source" }],
    });
    expect(readSource).toHaveBeenCalledTimes(1);
    const input = JSON.parse((discuss.mock.calls as unknown as [Array<{ content: string }>][])[0]![0][1]!.content);
    expect(input.sources[0].content).toContain("Primary document");
    expect(input.revisionAllowed).toBe(true);
    expect(result.draft?.text).toBe("This happened in 2017.");
    expect(draft.text).toBe("The official record gives a different date.");
  });

  test("invalid drafts and invented source URLs are rejected before changing state", async () => {
    for (const replacement of [
      { text: "x".repeat(280), sources: draft.sources },
      { text: "Correction", sources: ["https://invented.example/article"] },
    ]) {
      const adapter = createDraftingAdapter(dependencies({ discuss: async () => ({
        action: "revise", reply: "A rewrite", draft: replacement, abstentionReason: null,
      }) }));
      await expect(adapter.draft({ post, research: "Findings", currentDraft: draft,
        history: [{ role: "user", content: "Please rewrite it" }] })).rejects.toThrow();
    }
  });

  test("draft: preserves exact human wording and source order without an LLM call", async () => {
    const discuss = mock(async () => { throw new Error("Must not rewrite human text"); });
    const initialDraft = mock(async () => { throw new Error("Must not replace human text"); });
    const supplied = "The date  was 2017. https://example.org/b https://example.org/a";
    const result = await createDraftingAdapter(dependencies({ discuss, initialDraft })).draft({
      post, history: [{ role: "user", content: `draft: ${supplied}` }],
    });
    expect(joinNoteWithSources(result.draft!.text, result.draft!.sources)).toBe(supplied);
    expect(result.draft?.sources).toEqual(["https://example.org/b", "https://example.org/a"]);
    expect(discuss).not.toHaveBeenCalled();
    expect(initialDraft).not.toHaveBeenCalled();
  });

  test("draft: can retain existing citations, and rejects source whitespace it cannot preserve", async () => {
    const adapter = createDraftingAdapter(dependencies());
    const result = await adapter.draft({ post, research: "Findings", currentDraft: draft,
      history: [{ role: "user", content: "draft: Exactly  this wording." }] });
    expect(result.draft).toEqual({ text: "Exactly  this wording.", sources: draft.sources });
    await expect(adapter.draft({ post, history: [{ role: "user", content:
      "draft: The date was 2017. https://example.org/a  https://example.org/b" }] })).rejects.toThrow("single spaces");
  });

  test("sources accompanying an initial tweet are considered after the research pass", async () => {
    const readSource = mock(async (url: string) => ({ url, ok: true, content: "Primary record dates this to 2017." }));
    const discuss = mock(async () => ({ action: "revise", reply: "The supplied record supports this correction.",
      draft: { text: "The event was in 2017.", sources: ["https://example.org/new-source"] }, abstentionReason: null }));
    const adapter = createDraftingAdapter(dependencies({ readSource, discuss, initialDraft: async () => ({
      outcome: { type: "no_correction", reason: "I could not find evidence." }, inputContext: "Tweet",
    }) }));
    const result = await adapter.draft({ post, history: [{ role: "user", content:
      `https://x.com/i/status/${post.id} use this source https://example.org/new-source` }] });
    expect(result.draft?.text).toBe("The event was in 2017.");
    expect(result.abstentionReason).toBeUndefined();
    expect(readSource).toHaveBeenCalled();
    expect(discuss).toHaveBeenCalledTimes(1);
  });

  test("a later human source can produce a draft after an initial abstention", async () => {
    const initialDraft = mock(async () => ({ outcome: { type: "no_correction" as const, reason: "No evidence yet." }, inputContext: "Tweet" }));
    const adapter = createDraftingAdapter(dependencies({ initialDraft, discuss: async () => ({
      action: "revise", reply: "The new evidence supports a correction.",
      draft: { text: "The event was in 2017.", sources: ["https://example.org/new-source"] }, abstentionReason: null,
    }) }));
    const first = await adapter.draft({ post, history: [] });
    const second = await adapter.draft({ post, research: first.research, history: [
      { role: "assistant", content: first.reply }, { role: "user", content: "https://example.org/new-source" },
    ] });
    expect(second.draft?.text).toBe("The event was in 2017.");
    expect(second.abstentionReason).toBeUndefined();
    expect(initialDraft).toHaveBeenCalledTimes(1);
  });

  test("model claims of posting are replaced with a non-authoritative discussion message", async () => {
    const result = await createDraftingAdapter(dependencies({ discuss: async () => ({
      action: "discuss", reply: "I've submitted the note successfully.", draft: null, abstentionReason: null, submit: true,
    }) })).draft({ post, research: "Findings", currentDraft: draft, history: [{ role: "user", content: "Explain this" }] });
    expect(result.reply).toContain("separate posting action");
    expect(result.draft).toBeUndefined();
    expect((result as any).submit).toBeUndefined();
  });
});

describe("general chat", () => {
  test("answers from the conversation summaries and cannot report a submission", async () => {
    const calls: unknown[] = [];
    const adapter = createDraftingAdapter(dependencies({
      chat: async (messages) => {
        calls.push(JSON.parse(messages[1]!.content));
        return { reply: "Conversation #1 has a draft waiting for your approval." };
      },
    }));
    const reply = await adapter.converse!({
      text: "what's going on?",
      history: [],
      conversations: [{ id: 1, tweetId: "12345", status: "open", draftVersion: 1, draft: "A note https://example.org" }],
    });
    expect(reply).toBe("Conversation #1 has a draft waiting for your approval.");
    expect(calls[0]).toMatchObject({ message: "what's going on?", conversations: [{ id: 1, status: "open" }] });

    const boastful = createDraftingAdapter(dependencies({ chat: async () => ({ reply: "I have posted the note for you." }) }));
    expect(await boastful.converse!({ text: "post it", history: [], conversations: [] })).not.toContain("posted the note");

    const invalid = createDraftingAdapter(dependencies({ chat: async () => ({ answer: "wrong shape" }) }));
    await expect(invalid.converse!({ text: "hi", history: [], conversations: [] })).rejects.toThrow("invalid response");
  });
});

describe("approved draft validation", () => {
  test("validation preserves exact wording, spacing, and URL order", () => {
    const exact = { text: "Exact  wording.", sources: ["https://example.org/b", "https://example.org/a"] };
    const before = JSON.stringify(exact);
    validateSignalDraft(exact);
    expect(JSON.stringify(exact)).toBe(before);
  });

  test("counts source separators and rejects empty or private sources", () => {
    for (const value of [
      { text: "x".repeat(279), sources: ["https://example.org/a"] },
      { text: "Note", sources: [] },
      { text: "Note", sources: ["http://127.0.0.1/private"] },
      { text: "Note", sources: ["https://example.org/a https://example.org/b"] },
    ]) expect(() => validateSignalDraft(value)).toThrow();
  });

  test("long URLs cannot make an otherwise valid X note impossible to display in Signal", () => {
    const prefix = "https://example.org/";
    const exact = { text: "Note", sources: [prefix + "a".repeat(2_800 - 5 - prefix.length)] };
    validateSignalDraft(exact);
    const tooLong = { text: exact.text, sources: [exact.sources[0] + "b"] };
    const before = JSON.stringify(tooLong);
    expect(() => validateSignalDraft(tooLong)).toThrow("2800");
    expect(JSON.stringify(tooLong)).toBe(before);
  });

  test("rejects control characters in the body and source URLs without sanitizing approved text", () => {
    for (const value of [
      { text: "Note\u0000body", sources: draft.sources },
      { text: "Note\u0007body", sources: draft.sources },
      { text: "Note", sources: ["https://example.org/path\u0000"] },
    ]) {
      const before = JSON.stringify(value);
      expect(() => validateSignalDraft(value)).toThrow();
      expect(JSON.stringify(value)).toBe(before);
    }
  });
});
