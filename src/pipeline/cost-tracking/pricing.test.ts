import { describe, expect, test } from "bun:test";
import { SERPER_COST_PER_SEARCH, addTokenCost, emptyTokenCost, extractOpenRouterCost, whisperTranscriptionCost } from "./pricing";

describe("per-use API prices", () => {
  test("a Serper search costs one fifty-thousandth of the $50 plan", () => {
    expect(SERPER_COST_PER_SEARCH).toBeCloseTo(0.001, 10);
  });

  test("Whisper bills an hour of audio at $0.111", () => {
    expect(whisperTranscriptionCost(3600).cost).toBeCloseTo(0.111, 10);
  });

  test("Whisper bills a clip shorter than 10 seconds as 10 seconds", () => {
    expect(whisperTranscriptionCost(3).cost).toBeCloseTo(whisperTranscriptionCost(10).cost, 10);
  });
});

describe("prompt cache tokens", () => {
  const usage = { prompt_tokens: 7000, completion_tokens: 300, cost: 0.02, prompt_tokens_details: { cached_tokens: 3501, cache_write_tokens: 3400 } };

  test("an OpenRouter response keeps the cached and the cache-write tokens", () => {
    expect(extractOpenRouterCost({ usage })).toEqual({ input_tokens: 7000, output_tokens: 300, cost: 0.02, cached_tokens: 3501, cache_write_tokens: 3400 });
  });

  test("a response without token details has no cache fields", () => {
    expect(extractOpenRouterCost({ usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 } })).toEqual({ input_tokens: 10, output_tokens: 2, cost: 0.001 });
  });

  test("adding costs adds the cache tokens too", () => {
    const total = emptyTokenCost();
    addTokenCost(total, extractOpenRouterCost({ usage }));
    addTokenCost(total, extractOpenRouterCost({ usage }));
    addTokenCost(total, { input_tokens: 1, output_tokens: 1, cost: 0 });
    expect(total).toMatchObject({ input_tokens: 14001, cached_tokens: 7002, cache_write_tokens: 6800 });
  });
});
