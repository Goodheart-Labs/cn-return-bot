# Can Muse use its own search through OpenRouter?

Jim's question, 2026-09-24: can we use Muse's native tooling through OpenRouter instead of our own Serper loop? Answer: **yes, search works today.** Probe script: `probeMuseNativeTools.ts` (run 2026-09-24, six requests, about $0.08 in total).

## What was tested

OpenRouter offers "server tools": tools listed in the request that run on the provider's or OpenRouter's side inside a single API call, so our code runs no loop. Both Muse endpoints on OpenRouter list a `web_search` price of $0.0025 per search, which is the price of a provider's own search.

| Case | Request | Result |
| --- | --- | --- |
| A | `openrouter:web_search` with `engine: "native"`, a plain question | Worked. Meta served it. 5 searches, 22.9 s, $0.0145. Correct verdict with CDC and STAT citations. |
| B | `openrouter:web_search` with no engine set (defaults to native when the provider has one) | Worked. 7 searches, 30.5 s, $0.0202. Quoted the CDC page word for word: "The 2,065 cases is the most in the United States since 1992, when 2,126 cases were reported." |
| C | `openrouter:web_fetch` with `engine: "native"`, asked to quote a sentence from a CDC page | Worked. 6 to 8 s, $0.0015. Returned the exact sentence. Usage shows OpenRouter executed the tool itself, not Meta. The response names "OpenAI" as provider although the model is Muse; I could not find out why. |
| D | Production shape: native search plus our own `web_fetch` function tool plus a strict `json_schema` response format | Worked twice. 6 and 7 searches, 23 to 37 s, $0.017 and $0.020. Muse never called our function tool. |

## What the answer looks like

- **The research happens inside Meta's API.** The narration Muse writes between steps ("I found the CDC's measles page, now I'll open it to read the year-end figures") suggests Meta's harness both searches and opens pages. That matches the leaked Meta tool set in `TOOLS.md` section 7: search with alternative queries, open, find. We cannot see those steps. The only record is `server_tool_use_details.web_search_requests`.
- **The response carries citations, not results.** Each cited source is a `url_citation` annotation: URL, title and the character span of the answer it supports. The snippets and page text Muse read are not returned. Our existing `appendSonarCitations` in `searchDispatch.ts` already turns such annotations into a URL list for the note writer.
- **JSON is not clean.** Even with a strict `json_schema`, the content starts with a few lines of narration and the JSON object follows. `extractJsonObject`, which the Opus path already uses, would handle it.
- **Search cannot be forced.** Meta accepts only `tool_choice: "auto"`. Muse searched in all six runs anyway.

## Cost against today's Serper loop

Current claim checks, from the last 150 prod rows with a search loop (2026-09-24, 19:32 to 20:22 UTC):

| | Today (Muse plus Serper loop) | Muse with native search (probe, 4 runs) |
| --- | --- | --- |
| Model tokens for the search step | median $0.0023 | about $0.002 |
| Search fees | about 5.6 searches × $0.001 = about $0.006, assuming our Serper tier; **not recorded in our cost logs** | 5 to 7 searches × $0.0025 = $0.0125 to $0.0175 |
| Search step total | about $0.008 | $0.015 to $0.020 |

So native search roughly doubles the search step, which would add about $0.01 to a claim check whose median recorded cost is $0.016. Separately: Serper's fee never enters `everything_pipeline_runs.cost`, because `handleGoogleSearchRaw` returns no cost. The daily spend cap and pacing therefore undercount today's real spend by roughly a third of the search step.

## Trade-offs

In favour:
- One API call replaces our loop, with its turn cap, forced tool call, missing error handling and runaway risk.
- Muse runs in the harness Meta built for it, which has the multi-query search and page windows that `TOOLS.md` recommends we build.
- In these probes it read primary sources and quoted them exactly.

Against:
- We cannot see or log what it searched or read, only the pages it cited.
- Our fetch ladder (three browser identities, archives, headless Chromium) is not used. How Meta's fetcher handles the sites that block datacenter IPs (Reuters, NYT, cbo.gov) is unknown.
- About double the search cost.
- Meta decides how many searches to run; there is no `max_uses` for native search.

The source verifier is unaffected: it fetches cited pages through our own ladder regardless of how the search step found them.

## Not tested

- How often the answer holds up across many claims. Four runs on one easy claim say nothing about accuracy.
- The sites that block us. A run on claims whose best source is on Reuters, NYT or a .gov site would show whether Meta's fetcher gets through where ours fails.
- Whether `openrouter:web_fetch` with the native engine behaves the same for Muse in a longer research session.
