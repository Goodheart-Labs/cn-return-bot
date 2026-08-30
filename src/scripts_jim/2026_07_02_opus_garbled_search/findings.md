# Opus 4.8 garbled search findings (2026-07-02)

## Trigger
A prod `simple_bot_search` log showed Claude Opus returning garbled `findings`:

```
findings: "speclintAstwood 96 dquote loneliness aging</</</"
correction_needed: false
```

This is the `opus48-native` variant of `SIMPLE_BOT_SEARCH_TEST`
(`search_model: anthropic/claude-opus-4.8`, `web_search: native`), which runs
`searchWithAnthropicNative` — the only search path that combines Anthropic's
server-side `web_search_20260209` tool with a strict `json_schema`
`response_format`.

## Reproduction (`run.ts`) — faithful, via the real `dispatchSearch`
20 reruns of the exact prod call (same system prompt, user message, tool,
response_format, provider routing):

- **16/20 (~80%) corrupted / unusable.** Only ~4/20 produced a clean, usable
  research summary.
- Failure modes (one root cause, three faces):
  - **silent garble** (7): salad lands inside valid JSON → passes `JSON.parse`
    → the note-writer is fed junk like `"speclintAstwood 96 dquote…"`. This is
    the original log.
  - **invalid-JSON error** (4): salad breaks JSON → `ModelOutputInvalidError` →
    tweet fails. Several showed *multiple concatenated JSON objects* (the model
    restarts mid-generation).
  - **empty content** (3): all 4 retries empty → fails.
  - plus subtle character-salad even in some "clean-looking" outputs
    ("reidence"→evidence, "newsports"→news reports, "Cl Cl Cl Cl Clint"), and
    leaked **tool-call XML** — `<invoke name=`, `</parameter>` — which is the
    model's own tool-use vocabulary bleeding into the JSON text channel.

## Ablation (`ablation.ts`) — what causes it
6 runs each, toggling one factor:

| Variant | model | tool | json_schema | result |
|---|---|---|---|---|
| A (prod) | opus-4.8 | ✅ | ✅ | **corrupted** |
| B | opus-4.8 | ✅ | ❌ (prompted JSON) | **clean** (coherent prose+JSON) |
| C | opus-4.8 | ❌ | ✅ | **clean 6/6** |
| D | sonnet-4.6 | ✅ | ✅ | **clean 6/6** |

**Root cause:** neither the web_search tool nor the strict json_schema corrupts
on its own (B, C clean). Only the **combination**, and only on **Opus 4.8** — the
identical tool+schema combo on **Sonnet 4.6 is 6/6 clean** (D). Anthropic has no
native OpenAI-style `response_format`; OpenRouter emulates strict JSON (forced
tool / prefill), and on Opus that emulation collides with the real server-side
web_search tool, corrupting the decode and leaking tool-call XML.

## Blast radius
`opus48-native` carries weight 5 of ~30 total in `SIMPLE_BOT_SEARCH_TEST` → ~17%
of simple-bot search traffic runs on Opus, ~80% of which is corrupted → roughly
**1 in 8 simple-bot searches ships corrupted "research"** to the note-writer.
`sonnet46-native` (the other primary arm) is unaffected.

## Recommended fix
1. **Immediate:** pin `opus48-native` weight to 0 in `abTestsData.ts` (it is
   actively feeding salad to note-writers).
2. **If Opus search is wanted later:** route the Anthropic-native path through
   prompted-JSON (drop `response_format` when a server-side tool is attached),
   as `searchWithOpenaiNative` / `searchWithSonarBundled` already do — but add
   robust JSON extraction, since Opus emits a reasoning preamble before the JSON
   (variant B).

## Files
- `run.ts` — 20× faithful rerun via `dispatchSearch`; `results.jsonl`
- `ablation.ts` — A/B/C/D isolation; `ablation.jsonl`
- `userMessage.txt` — exact prod user message
