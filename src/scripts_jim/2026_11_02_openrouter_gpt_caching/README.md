# GPT-6.1 Terra through OpenRouter (GOO-688)

Can the GPT note writer harness (`src/agent-notes/`) run through OpenRouter
instead of a direct OpenAI key? Probed on 2026-11-02 with the testing key,
about $0.50 in all.

- `probe.ts implicit explicit flex websearch recall parallel subagents`: raw
  requests to OpenRouter's Responses API, printing the cache counters.
- `direct.ts`: the memory test against OpenAI directly, comparing a replayed
  conversation with one continued by `previous_response_id`.
- `bisect.ts`: finds the field of the Agents SDK's request that OpenRouter
  refuses.
- `e2e.ts [effort] [tier]`: the real harness on a small made-up post.
- `checkQuotes.ts [run.json]`: whether a run's source quotes are on their
  pages.

## Findings

- OpenRouter lists `openai/gpt-6.1-terra` at OpenAI's list prices, with a flex
  endpoint at half price and an Azure endpoint 20% dearer. The harness allows
  only OpenAI's endpoints, because Azure keeps a cache of its own.
- Implicit caching works: the same request twice read all 4,335 prefix tokens
  from the cache the second time ($0.0054 then $0.00025).
- The explicit breakpoint works: the first request was billed at the 12-hour
  write rate (2.5 times input), and a second request with a different task read
  the examples from the cache. `prompt_cache_key` reaches OpenAI (the response
  echoes it).
- OpenRouter reports `cached_tokens`, `cache_write_tokens` and the billed
  `cost`, web searches included, but not the split of writes by lifetime.
- OpenRouter refuses `prompt_cache_options: { mode: "implicit" }` with a bare
  "Invalid Responses API request". Implicit is OpenAI's default, so the harness
  no longer names the mode.
- OpenAI's `web_search` tool works through OpenRouter, but every action comes
  back as `{ type: "search", query: "" }`, so open page and find in page are
  invisible. The pages are read all the same: all 6 quotes of the end-to-end
  run are on their pages word for word.
- Search results do not survive into the next turn. OpenRouter keeps no
  conversations, and the search result text is not part of the items that come
  back. Asked in turn 2 about a detail of the page from turn 1, the model said
  it did not open the page. Forks searched again in their second turn.
- Flex was refused all day with OpenAI's own "Flex processing is temporarily
  unavailable". The harness then fails at once with "response.failed".
- The end-to-end run through OpenRouter: 3 forks, each read its parent's
  conversation from the cache (34,925 of 34,928 tokens), the false claim got a
  correct note, $0.17 in 40 seconds at low effort.
- OpenRouter refuses `previous_response_id` ("previous_response_id is not
  supported on this proxy. Each response request is independent.") and
  `store: true`.
- Parallel requests read the cache: 8 of 8 after a warm-up.
- The tools are part of the cached prefix. With the full examples, a request
  with the main agent's tools cached 34,155 tokens, and one with only web
  search 34,120. So the SDK subagents, which have only web search, keep their
  own cached copy of the examples. When several cold subagents start at once,
  the first one OpenAI processes writes it and the others read it (3 of 4).
- The direct OpenAI key's organisation may use only 10,000 tokens per minute.
  A request with web search counts as about 14,000 even with a tiny prompt, so
  `direct.ts` cannot run until the organisation moves up a usage tier.
