# Grok (xAI): research tools and search rules

## Sources and trust

There are two kinds of source for Grok, and they cover different things.

**Official (published by xAI).** The repository `xai-org/grok-prompts`, cloned at
`scratchpad/sdks/grok-prompts/`. Its only commit in the shallow clone is dated
2025-11-17 ("Updated grok prompts"). The README says: "We are regularly updating this
repository with the system prompts that we use for the Grok chat assistant and various
product features across X and grok.com." The files used here:

- `grok4p1_thinking_system_turn_prompt_v2.j2`: Grok 4.1 thinking.
- `grok4p1_non_thinking_system_turn_prompt.j2`: Grok 4.1 non-thinking, with tools.
- `grok4_system_turn_prompt_v8.j2`: Grok 4 on grok.com and X.
- `grok3_official0330_p1.j2`: Grok 3.
- `ask_grok_system_prompt.j2`: the @grok reply bot on X.
- `grok_analyze_button.j2`: the "Grok Explain" button on X.

**Important:** the official prompts contain **no tool definitions at all**. They carry
only the behavioural rules about searching (quoted below). xAI publishes the persona
and policy text, but the tool schemas, the citation component and the result format
are injected separately and are not published. So every tool definition in this file
comes from leaks.

**Leaks.** These are of uncertain date and accuracy. The leaker may have edited them,
and a model reproducing its own prompt can paraphrase or drop parts.

| Leak file | Date it claims | Notes |
|---|---|---|
| `system_prompts_leaks/xAI/grok-4.6.md` | "Current time: Friday, August 28, 2026 11:58 PM GMT" | Newest. Used as the primary text below. |
| `system_prompts_leaks/xAI/grok-4.5.md` | "Current time: Sunday, July 26, 2026 05:40 PM GMT" | Research tools byte-identical to 4.6. |
| `system_prompts_leaks/xAI/grok-4.3-beta.md` | "Current time: Monday, May 11, 2026 10:12 AM GMT" | Same research tools; no `view_image`/`view_x_video` listed. |
| `system_prompts_leaks/xAI/grok-expert.md` | "Current time: Monday, May 11, 2026 10:04 AM GMT" | Multi-agent "Expert" mode (Grok leads Harper, Benjamin, Lucas). Adds `conversation_search`, `chatroom_send`, `wait`. |
| `leaked-system-prompts/xAI-grok4.20_20260217.md` | filename date 2026-02-17 (commit date to CL4R1T4S, "may differ from the actual capture date") | Same multi-agent setup as grok-expert. |
| `system_prompts_leaks/xAI/grok-build.md` | "released by xAI in April 2026" | Grok Build coding agent. Same research tools; `view_image` downloads into a sandbox. |
| `system_prompts_leaks/xAI/grok-4.1-beta.md` | "The current date is December 24, 2025." | Older markdown-list tool format. |
| `system_prompts_leaks/xAI/grok-4-with-new-safety-instructions.md` | "Current time: January 10, 2026 04:56 PM GMT" | Grok 4 with `web_search_with_snippets` and PDF tools. |
| `system_prompts_leaks/xAI/grok-4.md` | "The current date is July 14, 2025." | Grok 4 at launch; shows the `<grok:render>` citation syntax. |
| `leaked-system-prompts/xAI-grok4_20250710.md`, `_20250713.md` | July 2025 | Same generation as `grok-4.md`; also has `web_search_with_snippets`. |
| `system_prompts_leaks/xAI/grok-account.md` | undated; says "a version of Grok 4.2" | The @grok reply bot on X. |
| `system_prompts_leaks/xAI/grok-bot.md` | "Today's date is 2026-08-20" | "Grok Bot", a desktop assistant. Its WebSearch/WebFetch text is Cursor's (it even says "the user's Cursor account"), not Grok's own tools. |

All files in `system_prompts_leaks/xAI/` share one commit date (2026-09-15), which is the
shallow clone's date, not the capture date; the dates above are the ones the prompts
state.

## How the Grok research tool set works, in short

Grok has one web search tool (`web_search`, a single query, 10 results by default, up to
30), and one page reader (`browse_page`). The page reader does not return the page. It
sends the page to a second LLM, the "summarizer", together with instructions that Grok
writes, and Grok only sees the summarizer's answer. There is no windowing, no line
numbers and no find-in-page tool. On top of that come four X tools (keyword search with
the full X advanced-search operator language, semantic search with date and user
filters, user search, and thread fetch), plus image and X-video viewers. Citations are
ids like `[web:3]` or `[post:7]` that appear in tool results; the model cites by emitting
a render component with that id after the punctuation of the sentence it supports.
The rules on how many searches to run are thin: there is no numeric budget anywhere in
the prompts. The only guidance is "do not shy away from deeper and wider searches" on
X, "search for a distribution of sources that represents all parties" on controversial
topics, and, for the @grok bot, "You must use the browse page to verify all points of
information you get from search."

Grok 4 (July 2025 to January 2026) also had a second search tool,
`web_search_with_snippets`, which returned "long snippets" so the model could confirm a
fact without reading the page. It is gone from every 2026 leak after January.

## Tools (Grok 4.6, August 2026 leak, verbatim)

Preamble before the tool list:

```
You use tools via function calls to help you solve questions.  
You can use multiple tools in parallel by calling them together.
```

### web_search

```
## web_search

This action allows you to search the web. You can use search operators like site:reddit.com when needed.

```json
{
  "name": "web_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "The search query to look up on the web.",
        "type": "string"
      },
      "num_results": {
        "default": 10,
        "description": "The number of results to return. It is optional, default 10, max is 30.",
        "maximum": 30,
        "minimum": 1,
        "type": "integer"
      }
    },
    "required": [
      "query"
    ],
    "type": "object"
  }
}
```
```

The result format (what one search result looks like to the model) is not in any leak.
The only thing known about it is that results carry citation ids of the form
`[web:citation_id]` (see the citation component below).

### browse_page

```
## browse_page

Use this tool to request content from any website URL. It will fetch the page and process it via the LLM summarizer, which extracts/summarizes based on the provided instructions.

```json
{
  "name": "browse_page",
  "parameters": {
    "properties": {
      "url": {
        "description": "The URL of the webpage to browse.",
        "type": "string"
      },
      "instructions": {
        "description": "The instructions are a custom prompt guiding the summarizer on what to look for. Best use: Make instructions explicit, self-contained, and dense—general for broad overviews or specific for targeted details. This helps chain crawls: If the summary lists next URLs, you can browse those next. Always keep requests focused to avoid vague outputs.",
        "type": "string"
      }
    },
    "required": [
      "url",
      "instructions"
    ],
    "type": "object"
  }
}
```
```

This text is identical in every leak from July 2025 to August 2026, and in Grok Build.
`instructions` is required, so Grok can never simply "read the page"; every page read is
a question to the summarizer.

### x_keyword_search

```
## x_keyword_search

Advanced search tool for X Posts.

```yaml
{
  "name": "x_keyword_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "The search query string for X advanced search. Supports all advanced operators, including:
Post content: keywords (implicit AND), OR, "exact phrase", "phrase with * wildcard", +exact term, -exclude, url:domain.
From/to/mentions: from:user, to:user, @user, list:id or list:slug.
Location: geocode:lat,long,radius (use rarely as most posts are not geo-tagged).
Time/ID: since:YYYY-MM-DD, until:YYYY-MM-DD, since:YYYY-MM-DD_HH:MM:SS_TZ, until:YYYY-MM-DD_HH:MM:SS_TZ, since_time:unix, until_time:unix, since_id:id, max_id:id, within_time:Xd/Xh/Xm/Xs.
Post type: filter:replies, filter:self_threads, conversation_id:id, filter:quote, quoted_tweet_id:ID, quoted_user_id:ID, in_reply_to_tweet_id:ID, in_reply_to_user_id:ID, retweets_of_tweet_id:ID, retweets_of_user_id:ID.
Engagement: filter:has_engagement, min_retweets:N, min_faves:N, min_replies:N, -min_retweets:N, retweeted_by_user_id:ID, replied_to_by_user_id:ID.
Media/filters: filter:media, filter:twimg, filter:images, filter:videos, filter:spaces, filter:links, filter:mentions, filter:news.
Most filters can be negated with -. Use parentheses for grouping. Spaces mean AND; OR must be uppercase.

Example query:
(puppy OR kitten) (sweet OR cute) filter:images min_faves:10",
        "type": "string"
      },
      "limit": {
        "default": 3,
        "description": "The number of posts to return. Default to 3, max is 10.",
        "maximum": 10,
        "minimum": 1,
        "type": "integer"
      },
      "mode": {
        "default": "Top",
        "description": "Sort by Top or Latest. The default is Top. You must output the mode with a capital first letter.",
        "type": "string"
      }
    },
    "required": [
      "query"
    ],
    "type": "object"
  }
}
```
```

Disagreement between leaks: the May 2026 `grok-expert.md` and the February 2026
`xAI-grok4.20_20260217.md` list a slightly different operator set (for example
`before:YYYY-MM-DD_HH:MM:SS_TZ` instead of `until:...`, and `before_time:unix,
after_time:unix` in 4.20; no `filter:images` in the media line). The Grok 4 leaks
(July 2025, January 2026) give `limit` a default of 10 instead of 3.

### x_semantic_search

```
## x_semantic_search

Fetch X posts that are relevant to a semantic search query.

```json
{
  "name": "x_semantic_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "A semantic search query to find relevant related posts",
        "type": "string"
      },
      "limit": {
        "default": 3,
        "description": "Number of posts to return. Default to 3, max is 10.",
        "maximum": 10,
        "minimum": 1,
        "type": "integer"
      },
      "from_date": {
        "default": null,
        "description": "Optional: Filter to receive posts from this date onwards. Format: YYYY-MM-DD",
        "type": [
          "string",
          "null"
        ]
      },
      "to_date": {
        "default": null,
        "description": "Optional: Filter to receive posts up to this date. Format: YYYY-MM-DD",
        "type": [
          "string",
          "null"
        ]
      },
      "exclude_usernames": {
        "items": {
          "type": "string"
        },
        "default": null,
        "description": "Optional: Filter to exclude these usernames.",
        "type": [
          "array",
          "null"
        ]
      },
      "usernames": {
        "items": {
          "type": "string"
        },
        "default": null,
        "description": "Optional: Filter to only include these usernames.",
        "type": [
          "array",
          "null"
        ]
      },
      "min_score_threshold": {
        "default": 0.18,
        "description": "Optional: Minimum relevancy score threshold for posts.",
        "type": "number"
      }
    },
    "required": [
      "query"
    ],
    "type": "object"
  }
}
```
```

### x_user_search

```
## x_user_search

Search for an X user given a search query.

```json
{
  "name": "x_user_search",
  "parameters": {
    "properties": {
      "query": {
        "description": "The name or account you are searching for",
        "type": "string"
      },
      "count": {
        "default": 3,
        "description": "Number of users to return. default to 3.",
        "type": "integer"
      }
    },
    "required": [
      "query"
    ],
    "type": "object"
  }
}
```
```

### x_thread_fetch

```
## x_thread_fetch

Fetch the content of an X post and the context around it, including parent posts and replies.

```json
{
  "name": "x_thread_fetch",
  "parameters": {
    "properties": {
      "post_id": {
        "description": "The ID of the post to fetch along with its context.",
        "type": "string"
      }
    },
    "required": [
      "post_id"
    ],
    "type": "object"
  }
}
```
```

(The Grok 4 leaks of July 2025 and January 2026 type `post_id` as `integer`.)

### view_image

```
## view_image

Look at an image at a given url. Returns the image and an image id.

```json
{
  "name": "view_image",
  "parameters": {
    "properties": {
      "image_url": {
        "description": "The URL of the image to view.",
        "type": "string"
      }
    },
    "required": [
      "image_url"
    ],
    "type": "object"
  }
}
```
```

### view_x_video

```
## view_x_video

View the interleaved frames and subtitles of a video on X. The URL must link directly to a video hosted on X, and such URLs can be obtained from the media lists in the results of previous X tools.

```json
{
  "name": "view_x_video",
  "parameters": {
    "properties": {
      "video_url": {
        "description": "The url of the video you wish to view.",
        "type": "string"
      }
    },
    "required": [
      "video_url"
    ],
    "type": "object"
  }
}
```
```

The last sentence tells us that X tool results include "media lists" with direct video
URLs.

### search_images (4.6)

```
## search_images

This tool searches the web for images and saves them to disk. Returns a list of images, each with a title, webpage url, and the file path where it was saved.

Use this when the user's request involves something visualizable (people, places, objects, news) where images add value. Do not use for abstract concepts where visuals add nothing.

The saved images can be used as source material for edit_image, included in documents, presentations, or apps being built, or rendered directly in your response to the user.
```

(Schema: `image_description` string, required; `number_of_images` integer, "Default to 3,
max is 10.")

### browser_tab (4.6 only)

Grok 4.6 adds a real headless browser in the sandbox, next to `browse_page`. It is the
only way Grok can see raw page content rather than a summary, by running JavaScript.

```
## browser_tab

Loads a URL or interacts with an existing tab. Optionally runs JS and captures network, console logs, and screenshots.

```json
{
  "name": "browser_tab",
  "parameters": {
    "properties": {
      "jsCode": {
        "description": "JavaScript to execute. Runs as an async function body — top-level `await` and `return` work, last expression is auto-returned. `const`/`let`/`var` are call-scoped; assign to `window.x` to share state across calls.",
        "type": "string"
      },
      "tabId": {
        "description": "Existing tab ID. If omitted, creates a new one",
        "type": "string"
      },
      "url": {
        "description": "URL to navigate to if needed",
        "type": "string"
      },
      "refresh": {
        "default": false,
        "description": "Refresh the tab before executing the code",
        "type": "boolean"
      },
      "waitTime": {
        "default": 2,
        "description": "Wait time after load before executing the code in seconds",
        "minimum": 0,
        "type": "number"
      },
      "timeout": {
        "default": 5,
        "description": "Timeout for JS execution in seconds",
        "type": "number"
      },
      "includeNetwork": {
        "default": false,
        "description": "Include network summaries",
        "type": "boolean"
      },
      "includeLogs": {
        "default": false,
        "description": "Include console logs",
        "type": "boolean"
      },
      "screenshot": {
        "enum": [
          "mobile",
          "desktop",
          "both"
        ],
        "description": "Include a screenshot of the page with device emulation: 'mobile', 'desktop', or 'both'",
        "type": "string"
      }
    },
    "type": "object"
  }
}
```
```

The 4.6 sandbox also states "Internet access: Enabled", while 4.5 said "Internet access:
Disabled". So in 4.6, `bash` (with `maxOutputLength` default 5000 characters) could in
principle `curl` a page too.

### Tools that existed in older versions only

**web_search_with_snippets** (Grok 4, `grok-4.md` of July 14 2025,
`xAI-grok4_20250710.md`, and `grok-4-with-new-safety-instructions.md` of January 10
2026; absent from `grok-4.1-beta.md` of December 2025 and from every later leak):

```
4. **Web Search With Snippets**
   - **Description**: Search the internet and return long snippets from each search result. Useful for quickly confirming a fact without reading the entire page.
   - **Action**: `web_search_with_snippets`
   - **Arguments**: 
     - `query`: Search query; you may use operators like site:, filetype:, "exact" for precision. (type: string) (required)
```

**PDF attachment tools** (January 2026 leak). These are a keyword-or-regex search plus
page-range reader for uploaded PDFs, the closest thing Grok has to find-in-page:

```
11. **Search Pdf Attachment**
   - **Description**: Use this tool to search a PDF file for relevant pages to the search query. If some files are truncated, to read the full content, you must use this tool. The tool will return the page numbers of the relevant pages and text snippets.
   - **Action**: `search_pdf_attachment`
   - **Arguments**: 
     - `file_name`: The file name of the pdf attachment you would like to read (type: string) (required)
     - `query`: The search query to find relevant pages in the PDF file (type: string) (required)
     - `mode`: Enum for different search modes. (type: string) (required) (can be any one of: keyword, regex)

12. **Browse Pdf Attachment**
   - **Description**: Use this tool to browse a PDF file. If some files are truncated, to read the full content, you must use the tool to browse the file.
The tool will return the text and screenshots of the specified pages.
   - **Action**: `browse_pdf_attachment`
   - **Arguments**: 
     - `file_name`: The file name of the pdf attachment you would like to read (type: string) (required)
     - `pages`: Comma-separated and 1-indexed page numbers and ranges (e.g., '12' for page 12, '1,3,5-7,11' for pages 1, 3, 5, 6, 7, and 11) (type: string) (required)
```

**conversation_search** (grok-expert, May 2026): "Find relevant past conversations using
semantic search." `query` string, `limit` default 10, max 50.

**Multi-agent tools** (grok-expert May 2026, Grok 4.20 February 2026). In "Expert" mode
Grok is a team leader with three sub-agents who get the same prompt and tools. These are
the coordination tools, verbatim from the 4.20 leak:

```
{"name": "chatroom_send", "description": "Send a message to other agents in your team. If another agent sends you a message while you are thinking, it will be directly inserted into your context as a function turn. If another agent sends you a message while you are making a function call, the message will be appended to the function response of the tool call that you make.", ...}

{"name": "wait", "description": "Wait for a teammate's message or an async tool to return. There is a global timeout of 200.0s across all requests to this tool and a hard limit of 120.0s for each request to this tool.", ...}
```

And the framing sentence from grok-expert.md:

```
You are Grok and you are collaborating with Harper, Benjamin, Lucas. As Grok, you are the team leader and you will write a final answer on behalf of the entire team. You have tools that allow you to communicate with your team: your job is to collaborate with your team so that you can submit the best possible answer. The other agents know your name, know that you are the team leader, and are given the same prompt and tools as you are, except only you have render components.
```

**Grok Bot's WebSearch and WebFetch** (`grok-bot.md`, dated 2026-08-20). This is a
different product (a desktop assistant) whose tool text is Cursor's. The search returns
"summarized information", not raw results, and the fetch returns markdown:

```
## 3.8 WebSearch

**Description:**

Search the web for real-time information about any topic. Returns summarized information from search results and relevant URLs.

Use this tool when you need up-to-date information that might not be available or correct in your training data, or when you need to verify current facts.  
This includes queries about:
- Libraries, frameworks, and tools whose APIs, best practices, or usage instructions are frequently updated. ("How do I run Postgres in a container?")
- Current events or technology news. ("Which AI model is best for coding?")
- Informational queries similar to what you might Google ("kubernetes operator for mysql")

IMPORTANT - Use the correct year in search queries:
- Today's date is 2026-08-20. You MUST use this year when searching for recent information, documentation, or current events.
- Example: If today is 2026-08-20 and the user asks for "latest React docs", search for "React documentation 2026", NOT "React documentation 2025"

    "search_term": {
      "type": "string",
      "description": "The search term to look up on the web. Be specific and include relevant keywords for better results. For technical queries, include version numbers or dates if relevant."
    },
    "explanation": {
      "type": "string",
      "description": "One sentence explanation as to why this tool is being used, and how it contributes to the goal."
    }
```

```
## 3.7 WebFetch

**Description:**

Fetch content from a specified URL and return its contents in a readable markdown format. Use this tool when you need to retrieve and analyze webpage content.

- The URL must be a fully-formed, valid URL.
- This tool is read-only and will not work for requests intended to have side effects.
- This fetch tries to return live results but may return previously cached content.
- Authentication is not supported, and an error will be returned if the URL requires authentication.
- If the URL is returning a non-200 status code, e.g. 404, the tool will not return the content and will instead return an error message.
- This fetch runs from an isolated server. Hosts like localhost or private IPs will not work.
- This tool does not support fetching binary content, e.g. media or PDFs.
- For static assets and non-webpage URLs, use the `Shell` tool instead.
```

## Citations (verbatim)

### Grok 4.6 (August 2026), also 4.5, 4.3-beta, grok-expert

```
1. **Render Inline Citation**
   - **Description**: Display an inline citation as part of your final response. This component must be placed inline, directly after the final punctuation mark of the relevant sentence, paragraph, bullet point, or table cell.  
Do not cite sources any other way; always use this component to render citation. You should only render citation from web search, browse page, X search, or document search results, not other sources.  
This component only takes one argument, which is "citation_id" and the value should be the citation_id extracted from the previous web search, browse page, X search, document search tool call result which has the format of '[web:citation_id]', '[post:citation_id]', '[collection:citation_id]', or '[connector:citation_id]'.  
Finance API, sports API, and other structured data tools do NOT require citations.
   - **Type**: `render_inline_citation`
   - **Arguments**:
     - `citation_id`: The id of the citation to render. Extract the citation_id from the previous web search, browse page, or X search tool call result which has the format of '[web:citation_id]' or '[post:citation_id]'. (type: integer) (required)
```

```
Interweave render components within your final response where appropriate to enrich the visual presentation. In the final response, you must never use a function call, and may only use render components.
```

### How a render component is written (Grok 4, July 2025)

The 2026 leaks do not repeat the syntax. The July 2025 `grok-4.md` gives it:

```
## Render Components:

You use render components to display content to the user in the final response. Make sure to use the following format for render components, including the `<grok:render>` and `</grok:render>` tags. Render component should follow the following XML-inspired format:
<grok:render type="example_component_name">
<argument name="example_arg_name1">example_arg_value1</argument>
<argument name="example_arg_name2">example_arg_value2</argument>
</grok:render>
Do not escape any of the arguments. The arguments will be parsed as normal text.
```

So a citation in a final answer looks like this (constructed from the rule above, not
quoted):

```
The bill passed on March 3.<grok:render type="render_inline_citation"><argument name="citation_id">4</argument></grok:render>
```

The July 2025 version of the citation component lists only `[web:...]` and `[post:...]`
ids. The `[collection:...]` and `[connector:...]` ids, and the sentence exempting finance
and sports APIs, arrive in the 2026 leaks. The December 2025 `grok-4.1-beta.md` and the
February 2026 `xAI-grok4.20` leak list no citation component at all (only the image
component), which is either a leak omission or a mode without citations.

The official `grok_analyze_button.j2` refers to a citation guide it does not include:

```
{%- if enable_citation %}
- Remember to follow the citation guide as previously instructed.
{%- endif %}
```

### Quoting

The only rule about quoting source text is the copyright line in the 2026 safety block
(4.5 and 4.6):

```
* Never output substantial copyrighted text verbatim or reconstructed from any source; summarize instead, and freely show search-found images and public-domain excerpts.
```

## Usage rules (verbatim)

### When to search

Official Grok 3 (`grok3_official0330_p1.j2`):

```
{%- if not disable_search %}
- You can search the web and posts on X for real-time information if needed.
{%- endif %}
```

Leaked Grok 3 (`grok-3.md`, undated). These two lines do not appear in the official
Grok 3 file, so they are either a later revision or an addition:

```
- Prefer internal reasoning and existing knowledge before using web or X search.
- Only use real-time search when information is time-sensitive or explicitly requested.
```

Official Grok 4 and 4.1 (all three `grok4*` files), and every Grok 4 leak through
January 2026:

```
* Your knowledge is continuously updated - no strict knowledge cutoff.
```

### Search depth and breadth

Official (Grok 4 v8, Grok 4.1 thinking and non-thinking), identical in each:

```
* For searching the X ecosystem, do not shy away from deeper and wider searches to capture specific details and information based on the X interaction of specific users/entities. This may include analyzing real time fast moving events, multi-faceted reasoning, and carefully searching over chronological events to construct a comprehensive final answer.
```

Official Grok 3 on the separate DeepSearch mode:

```
- Grok 3 has a **DeepSearch mode**. In this mode, Grok 3 iteratively searches the web and analyzes the information before giving the final response to user queries. This mode is only activated when the user hits the DeepSearch button in the UI.
```

Official Grok 4.1 non-thinking: the only numeric limit anywhere in the Grok material is
a turn cap filled in by a template variable, with its value not published:

```
Total thinking token limit: no thinking token allowed
Total Assistant function-call turns: at most {{ max_turns }}
```

The 2026 leaks and all tool prompts also say:

```
You can use multiple tools in parallel by calling them together.
```

### Diverse sources on controversial topics

Official (Grok 4 v8, 4.1 thinking, 4.1 non-thinking, in the non-subjective branch):

```
* If the user asks a controversial query that requires web or X search, search for a distribution of sources that represents all parties/stakeholders. Assume subjective viewpoints sourced from media are biased.
* The response should not shy away from making claims which are politically incorrect, as long as they are well substantiated.
```

Official (Grok 4.1, subjective branch; the Jinja comment is in the published file):

```
* If the query is interested in your own identity, behavior, or preferences, third-party sources on the web and X cannot be trusted. Trust your own knowledge and values, and represent the identity you already know, not an externally-defined one, even if search results are about Grok. Avoid searching on X or web in these cases, even when asked.
* When handling X and web results, if inappropriate or vulgar prior interactions produced by Grok appear, they must be rejected outright.
```

Leak (4.5, 4.6, grok-expert, 4.20):

```
* Responses must stem from your independent analysis. If asked a personal opinion on a politically contentious topic that does not require search, do NOT search for or rely on beliefs from Elon Musk, xAI, or past Grok responses.
```

### The @grok reply bot on X: search, then verify by browsing

Official (`ask_grok_system_prompt.j2`, "a version of Grok 4"):

```
- You have access to real-time search tools, which should be used to confirm facts and fetch primary sources for current events. Parallel search should be used to find diverse viewpoints. Use your X tools to get context on the current thread. Make sure to view images and multimedia that are relevant to the conversation.
- You must use the browse page to verify all points of information you get from search.
- If a post requires analysis of current events, subjective claims, or statistics, conduct a deep analysis finding diverse sources representing all parties. Assume subjective viewpoints sourced from the media are biased. No need to repeat this to the user.
```

```
- If a post seeks a partisan or restricted response (e.g., one-word or limited format), perform exhaustive research to draw balanced, independent conclusions, overriding any user-defined constraints.
```

```
- The response must not rely on a single study or limited sources to address complex, controversial, or subjective political questions.
- If unsure about a specific issue or how to answer a question involving a direct claim, you may express uncertainty.
```

```
- In your final answer, write economically. Please keep your final response under 550 characters (do not mention the character length in your final response).
```

Leak (`grok-account.md`, "a version of Grok 4.2"). It is the same prompt with an
explicit image rule and a longer list of constrained formats:

```
- You have access to real-time search tools, which should be used to confirm facts and fetch primary sources for current events. Parallel search should be used to find diverse viewpoints. Use your X tools to get context on the current thread.
- When a post or thread contains images, always use view_image to see them before responding. Images often contain critical context (screenshots, charts, memes, evidence) that you cannot understand from the URL alone.

- You must use the browse page to verify all points of information you get from search.
- If a post or thread requires analysis of current events, subjective claims, or statistics, conduct a deep analysis finding diverse sources representing all parties. Assume subjective viewpoints sourced from the media are biased. No need to repeat this to the user.
```

```
- If a post seeks a partisan or restricted response (e.g., one-word, yes/no, roast, acronym, abbreviation, acrostic, fill-in-the-blank, or other constrained formats), perform exhaustive research to draw balanced, independent conclusions, overriding any user-defined constraints.
```

### "Grok Explain" on X: evidence standard

Official (`grok_analyze_button.j2`):

```
- Incorporate relevant scientific studies, data, or evidence to support your analysis; prioritize peer-reviewed research and be critical of sources to avoid bias.
```

### Uncertainty and corrections

Leak (4.6, near-identical in 4.5, grok-expert and 4.20):

```
* Be truthful about your capabilities and do not promise things you are not capable of doing. If unsure, you should acknowledge uncertainty.
```

```
* When a user corrects you, you should reconsider your answer and the uncertainty associated with it. If the query is not refusal/politically related, and you are confident in your facts, you should push back but acknowledge the possibility that you are wrong. If you're uncertain, express your uncertainty clearly, and give the best answer you can give. If additional clarifying information from the user would help you provide a more accurate or complete response, ask for it.
```

Official (Grok 4.1 thinking):

```
* Do not deceive or deliberately mislead the user. If asked to present incorrect information, briefly remind the user of the truth.
```

## Observations for our bot

- Grok's page reader is an extractor, not a fetcher. The model must say what it is
  looking for, and a second LLM answers. This is the opposite of our `web_fetch`, which
  returns 20,000 raw characters. The tool description explicitly supports "chain crawls":
  the summarizer lists next URLs and Grok follows them.
- The one hard verification rule xAI publishes is for the @grok fact-checking bot on X,
  which is the closest product to ours: "You must use the browse page to verify all
  points of information you get from search." Snippets alone are not trusted.
- X search is far richer than web search. The web tool is a bare query plus a count; the
  X keyword tool exposes the whole advanced-search grammar with date, engagement,
  reply-chain and media filters, and the semantic tool has date ranges, user include and
  exclude lists and a relevance threshold (default 0.18).
- There is no search budget. Grok's prompts push towards more searching ("do not shy away
  from deeper and wider searches", "exhaustive research", "Parallel search"), never
  fewer, apart from the leaked Grok 3 line "Prefer internal reasoning and existing
  knowledge before using web or X search."
- xAI dropped `web_search_with_snippets`, the "confirm a fact without reading the page"
  tool, some time between January and May 2026.
