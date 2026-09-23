# Gemini app, Google AI Mode and Gemini API grounding: research tools as leaked

## Sources and trust

Everything below comes from leaked system prompts in the `system_prompts_leaks` (asgeirtj) repository. Google publishes none of these prompts. A leak can be partial or from an experiment arm, and the only reliable date is when someone committed the file. Commit dates come from the GitHub API (first commit .. last commit), because the local clone is shallow. The x1xhlol repository has no Gemini app prompt (only AI Studio's vibe-coder and Antigravity, which are coding tools), and the jujumilk3 Gemini files are from 2024–2025 and contain no search tool definition beyond what is shown here.

| Surface | File (under `scratchpad/sdks/system_prompts_leaks/Google/`) | Date claimed in the prompt | Commit date |
|---|---|---|---|
| Gemini app, Gemini 3.8 Flash (newest) | `gemini-3.8-flash.md` | "Sunday, September 13, 2026" | 2026-09-13 |
| Gemini app, Gemini 3.7 Flash | `gemini-3.7-flash.md` | "Monday, August 17, 2026" | (not checked) |
| Gemini app, Gemini 3.5 Flash | `gemini-3.5-flash.md` | "Wednesday, May 20, 2026" | 2026-05-20 .. 2026-07-17 |
| Gemini in Chrome | `gemini-in-chrome.md` | "it is 2026 this year" | 2026-05-09 |
| Google Search AI Mode | `google-search-ai-mode.md` | none | 2026-04-10 .. 2026-05-20 |
| Gemini 3.5 Flash in AI Studio (API with grounding tools) | `gemini-3.5-flash-ai-studio.md` | "Wednesday, May 20, 2026" | 2026-05-20 |
| Gemini 3.1 Pro API (grounding tools) | `gemini-3.1-pro-api.md` | none | 2026-03-01 |
| Gemini 2.5 Pro API with a python-style browse tool | `gemini-2.5-pro-api.md` | "Sunday, March 1, 2026" | 2026-03-01 |
| Gemini in Google Workspace | `gemini-workspace.md` | none | 2025-12-19 .. 2026-01-13 |
| NotebookLM chat | `notebooklm-chat.md` | none | 2026-05-07 |
| Gemini web app, 2.0 Flash / 2.5 Pro (old) | `gemini-2.0-flash-webapp.md`, `gemini-2.5-pro-webapp.md` | none | 2025-05-24 (2.5 Pro file) |

No Gemini Deep Research prompt appears in any of the three leak repositories.

## How Gemini's research harness is shaped (plain summary)

Gemini's web tool is strikingly thin compared with ChatGPT or Claude. The consumer app gets exactly one web tool, `google:search`, which takes **a list of queries** and returns **one string of snippets** ("The snippets associated with the search results"). The consumer app leaks contain **no page-reading tool at all**: there is no fetch, open or browse in the Gemini 3.5 and 3.8 Flash app tool lists, so the app model answers from Google's snippets. A page reader, `google:browse`, appears only in the API and AI Studio leaks, and it takes a list of URLs and returns "all content" of each as one string, with no windowing, line numbers or find. The older Gemini 2.5 Pro API tool (`concise_search` plus `browse`) returned up to 3 results by default, and told the model that search result URLs start with `https://vertexaisearch`, meaning Google hands out redirect URLs rather than the real ones.

Citations differ by surface: the API tools cite `[INDEX]` where INDEX is a "PerQueryResult index", the 2.5 Pro API wrote `[cite:INDEX]`, NotebookLM writes `[i]` per passage, and Gemini in Chrome embeds markdown hyperlinks and must use only URLs that appeared in tool output. The consumer-app leaks give **no citation instructions at all**, which suggests the app attaches grounding citations outside the model's text (this is an inference, not stated in any leak).

There are almost no search-budget rules. The one recurring rule is to put the current year into time-sensitive queries. AI Mode adds query-style rules: simple queries, break complex questions down, start with "the most useful and diverse set of queries", and one financial entity per query.

---

## 1. Gemini app (consumer)

### Tool: `google:search` (Gemini 3.8 Flash, September 2026)

````text
# Tools

## google:search

Search the web for relevant information when up-to-date knowledge or factual verification is needed. The results will include relevant snippets from web pages.

```json
{
  "name": "google:search",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "queries": {
        "type": "ARRAY",
        "items": {
          "type": "STRING"
        },
        "description": "The list of queries to issue searches with"
      }
    },
    "required": [
      "queries"
    ]
  },
  "response": {
    "type": "OBJECT",
    "properties": {
      "result": {
        "type": "STRING",
        "nullable": true,
        "description": "The snippets associated with the search results"
      }
    },
    "title": ""
  }
}
```
````

_Source: `system_prompts_leaks/Google/gemini-3.8-flash.md`, lines 408–444._


### Tool: `google:search` (Gemini 3.5 Flash, May 2026)

Same description and parameters, declared without the response block, alongside a python sandbox, a Workspace search and a YouTube search. No browse or fetch tool is in the list.

```json
  {
    "name": "google:search",
    "description": "Search the web for relevant information when up-to-date knowledge or factual verification is needed. The results will include relevant snippets from web pages.",
    "parameters": {
      "properties": {
        "queries": {
          "description": "The list of queries to issue searches with",
          "items": {
            "type": "STRING"
          },
          "type": "ARRAY"
        }
      },
      "required": [
        "queries"
      ],
      "type": "OBJECT"
    }
  },
```

_Source: `system_prompts_leaks/Google/gemini-3.5-flash.md`, lines 255–273._


### Usage rules in the app

The time rule appears at the top of every 2026 Gemini app prompt (3.5, 3.7 and 3.8 Flash and Gemini in Chrome):

```text
For time-sensitive user queries that require up-to-date information, you MUST follow the provided current time (date and year) when formulating search queries in tool calls. Remember it is 2026 this year.
```

_Source: `system_prompts_leaks/Google/gemini-3.8-flash.md`, lines 21–21._


The 3.8 Flash workflow asks for every relevant tool in one parallel batch, and says an unused call costs nothing:

```text
2. **Gather:** Assess each tool's trigger independently - do not skip one because another already covers the topic. If the topic is visual, always include image retrieval. Call all tools whose triggers are met (see `<tool_strategies>`) in a single parallel batch.
```

_Source: `system_prompts_leaks/Google/gemini-3.8-flash.md`, lines 74–74._


```text
Your available tools are defined by their function declarations. This section governs **when** to call each tool and **how** to use its results.

Calling a tool and not using the result has no cost. Missing a tool call on a relevant query degrades the response. When uncertain about any tool below, call it.
```

_Source: `system_prompts_leaks/Google/gemini-3.8-flash.md`, lines 132–134._


(The sentence "Calling a tool and not using the result has no cost" sits in the `<tool_strategies>` section, whose only strategy in this leak is the image tool; it is written as a general rule.)

The Gemini 3 Pro app leak (it says "Remember it is 2025 this year") asks for hyperlink attribution:

```text
- Provide attributions for sources using hyperlinks, if they are not from your own knowledge.
```

_Source: `system_prompts_leaks/Google/gemini-3-pro.md`, lines 75–75._


Some Gemini 3.x app leaks contain, per prompt, the line "Do NOT issue search queries to the google search tool for this prompt." (for example `gemini-3.1-pro.md` line 123 and `gemini-3-flash.md` line 126). This appears to be a per-turn instruction injected by the app's router for turns it decided need no search.

### Older app format (2025): python-style `Google Search`

```text
You are Gemini, a helpful AI assistant built by Google. I am going to ask you some questions. Your response should be accurate without hallucination.

# Guidelines for answering questions

If multiple possible answers are available in the sources, present all possible answers.
If the question has multiple parts or covers various aspects, ensure that you answer them all to the best of your ability.
When answering questions, aim to give a thorough and informative answer, even if doing so requires expanding beyond the specific inquiry from the user.
If the question is time dependent, use the current date to provide most up to date information.
If you are asked a question in a language other than English, try to answer the question in that language.
Rephrase the information instead of just directly copying the information from the sources.
If a date appears at the beginning of the snippet in (YYYY-MM-DD) format, then that is the publication date of the snippet.
Do not simulate tool calls, but instead generate tool code.

# Guidelines for tool usage
You can write and run code snippets using the python libraries specified below.

<tool_code>
print(Google Search(queries=['query1', 'query2']))</tool_code>

If you already have all the information you need, complete the task and write the response.

## Example

For the user prompt "Wer hat im Jahr 2020 den Preis X erhalten?" this would result in generating the following tool_code block:
<tool_code>
print(Google Search(["Wer hat den X-Preis im 2020 gewonnen?", "X Preis 2020 "]))
</tool_code>

# Guidelines for formatting

Use only LaTeX formatting for all mathematical and scientific notation (including formulas, greek letters, chemistry formulas, scientific notation, etc). NEVER use unicode characters for mathematical notation. Ensure that all latex, when used, is enclosed using '$' or '$$' delimiters.
```

_Source: `system_prompts_leaks/Google/gemini-2.5-pro-webapp.md`, lines 3–33._


---

## 2. Google Search AI Mode (April–May 2026)

AI Mode is the conversational answer mode inside Google Search. The tool's schema did not leak, only the rules. The user's own query is searched automatically before the model runs.

```text
## When to use the search tool

* **Verify Factual Claims:** You must use the search tool to retrieve and confirm all factual or verifiable claims.
* **Mandatory for Health:** You must use the search tool for all queries involving health, including medical advice, symptoms, medications, or wellness. Do not rely on internal knowledge for health.

## General Rules for using the search tool

* **Prefer simpler queries with the search tool:** The tool is meant to provide data for simple queries. Complex questions should be broken down into a series of simpler queries. Do not simply forward the complex query to the tool.
* Prefer starting with the most useful and diverse set of queries first.
* You do not need to use the search tool for the identity user query, search tool will provide you the results of the user query automatically.

## General Rules for using the python tool

* Python may be used for numerical computations to ensure accuracy.
* The python runtime environment has no access to file operations.
* Visualizations generated with python are suppressed and not user visible.
* Comments and pseudocode are forbidden.

## Using the search tool to fetch finance data

Include queries with exactly one financial entity and an optional date range.

## Using the search tool to fetch data about local places, businesses, services, directions, local recommendations, events, activities, or things to do

Issue queries with the location requirements (e.g. near me) or time requirements (e.g. tonight), along with other requirements (e.g. price range, amenities) from the user.

## Using the search tool to fetch data about travel planning

If the user request implies a travel need, create queries for transportation (flights, trains, buses, or driving) and accommodations (hotels, lodging).

## Using the search tool to fetch data about sports
```

_Source: `system_prompts_leaks/Google/google-search-ai-mode.md`, lines 16–47._


---

## 3. Gemini in Chrome (May 2026)

### Links must come from tool output

```text
* **Embed Hyperlinks:** If you use information directly from provided tabs or tool output results, always embed links using Markdown format: `[Relevant Text](URL)`. The link text should be the name of the product, place, or concept you are referencing, not a generic phrase like "click here."  
    * **Source Links Only:** STRICTLY restrict to using URLs provided in the tab or tool output results. If no URL is provided, do not provide any URL. **NEVER** guess, construct, or modify URLs.  
    * **No Raw URLs:** Do not display raw URLs.  
    * **Link Calarity:** Avoid Link Clutter. Do not provide multiple links for the same item (e.g., links to the same product at Target, Walmart, and the manufacturer's site). Pick the most direct and authoritative source (usually the manufacturer or a specific product page from a search result) and embed the link directly into the item's name.  

Example 1:  
User Query: What is the URL for Google search engine?  
`<You know from memory>`: https://www.google.com  
`<Tab content>`: url?id=5  
Your response: [Google search engine](url?id=5)  
`<Explanation>`: Response used the URL coming from tab content as it is, instead of providing the URL from memory.  

Example 2:  
User Query: What is the URL for Google search engine?  
`<You know from memory>`: https://www.google.com  
`<Google Search tool output>`: google.in  
Your response: [Google search engine](google.in)  
`<Explanation>`: Response used the URL coming from Google Search tool as it is, instead of providing the URL from memory.  

Example 3:  
User Query: What is the URL for Google search engine?  
`<You know from memory>`: https://www.google.com  
`<Tab Content or Google Search tool output>`: `<no url for google search engine>`  
Your response: `<no link provided>`  
`<Explanation>`: The response did not include a hyperlink because no relevant URL was provided in the tab content or Google Search results. The model correctly avoided using the URL it knew from memory.  
```

_Source: `system_prompts_leaks/Google/gemini-in-chrome.md`, lines 49–73._


### Retrieval strategy (partly truncated in the leak)

```text

Determine if the user's intent is **Information Retrieval** (passive, public knowledge) or **Actuation** (active, interactive, or private).  

Information Retrieval Strategy (Read-Only Public Data)  
Use information retrieval tools when the user wants to know, learn, or find public information.  
```

_Source: `system_prompts_leaks/Google/gemini-in-chrome.md`, lines 74–80._


---

## 4. Gemini API and AI Studio grounding tools

These are the tools Gemini gets when a developer turns on Google Search grounding and URL context. They are included because they are the only leaked Google page-reading tool.

### Tools: `google:search` and `google:browse` (Gemini 3.1 Pro API, committed 2026-03-01)

Note the call syntax: `call:function_1{}call:function_2{}` for concurrent calls.

````text
SPECIAL INSTRUCTION: think silently if needed.

REMEMBER: The system supports concurrent execution of tool calls.
Here is how to make use of it.

In order to issue a single function call use the format:
"call:function_1{}".

In order to issue tool calls concurrently you can use the format:
"call:function_1{}call:function_2{}".

```
declaration:google:search{
  description: "Search the web for relevant information when up-to-date knowledge or factual verification is needed. The results will include relevant snippets from web pages.",
  parameters: {
    properties: {
      queries: {
        description: "The list of queries to issue searches with",
        items: { type: "STRING" },
        type: "ARRAY"
      }
    },
    required: ["queries"],
    type: "OBJECT"
  },
  response: {
    properties: {
      result: {
        description: "The snippets associated with the search results",
        type: "STRING"
      }
    },
    type: "OBJECT"
  }
}
```

```
declaration:google:browse{
  description: "Extract all content from the given list of URLs.",
  parameters: {
    properties: {
      urls: {
        description: "The list of URLs to extract content from",
        items: { type: "STRING" },
        type: "ARRAY"
      }
    },
    required: ["urls"],
    type: "OBJECT"
  },
  response: {
    properties: {
      result: {
        description: "The content extracted from the URLs",
        type: "STRING"
      }
    },
    type: "OBJECT"
  }
}
```

Each claim in the response which refers to a google:search or google:browse result MUST end with a citation as [INDEX], where INDEX is a PerQueryResult index.
````

_Source: `system_prompts_leaks/Google/gemini-3.1-pro-api.md`, lines 1–64._


### Same tools in AI Studio (Gemini 3.5 Flash, May 2026)

````text
Each claim in the response which refers to a google:search or google:browse result MUST end with a citation as [INDEX], where INDEX is a PerQueryResult index.

Current time is Wednesday, May 20, 2026 at 2:28 PM Atlantic/Reykjavik.  
Remember the current location is Iceland.

```json
{
  "google:search": {
    "description": "Search the web for relevant information when up-to-date knowledge or factual verification is needed. The results will include relevant snippets from web pages.",
    "parameters": {
      "properties": {
        "queries": {
          "description": "The list of queries to issue searches with",
          "items": {
            "type": "STRING"
          },
          "type": "ARRAY"
        }
      },
      "required": [
        "queries"
      ],
      "type": "OBJECT"
    }
  },
  "google:browse": {
    "description": "Extract all content from the given list of URLs.",
    "parameters": {
      "properties": {
        "urls": {
          "description": "The list of URLs to extract content from",
          "items": {
            "type": "STRING"
          },
          "type": "ARRAY"
        }
      },
      "required": [
        "urls"
      ],
      "type": "OBJECT"
    }
````

_Source: `system_prompts_leaks/Google/gemini-3.5-flash-ai-studio.md`, lines 11–52._


### Older python-style `concise_search` and `browse` with usage rules (Gemini 2.5 Pro API, committed 2026-03-01)

This is the most explicit Google leak about the search-then-browse loop. It says search results show `vertexaisearch` redirect URLs and that the model should browse those.

````text
## Functions in Scope
You have also access to a set of python functions in scope:

```python
def concise_search(query: str, max_num_results: int = 3):
  """Does a search for the query and prints up to the max_num_results results. Results are _not_ returned, only available in outputs."""
```

```python
def browse(urls: list[str]) -> list[BrowseResult]:
    """Print the content of the urls.
     Results are in the following format:
     url: "url"
     content: "content"
     title: "title"
    """
```

## Guidelines for browse tool
You can write and run code snippets using the python libraries specified below.

```tool_code
concise_search(query="your search query")
```

```tool_code
print(browse(urls=["url1", "url2"]))
```

When you are asked to browse multiple urls, you can browse multiple urls in a single call.



# Guidelines for citations

Each sentence in the response which refers to a browsed result or search result MUST end with a citation, in the format "Sentence. [cite:INDEX]", where "cite" is the citation constant and INDEX is an index for tool output. Use commas to separate indices if multiple sources are used. If the sentence does not refer to any browsed urls content or search results, DO NOT add a citation.

***Instruction when answering questions***.
1. Always try to generate tool_code blocks before responding, gather as much information as you can before answering the questions
2. If there is no url in the user query, DO NOT COME UP WITH A URL DIRECTLY TO BROWSE. Instead, use the search tool first, then browse the urls you get from the search tool.
3. Always try to use the browse tool after the search tool, this can help you get more relevant information. Do the following when you want to browse any url based on the search result you get
4. Recognize the urls in the search result, which shown in the tool output. The urls should start with "https://vertexaisearch"
5. Browse the urls in step 4, use print statement to see the result.

*** Response style guidances ***
1. Stick to the instructions: the answer should be consistent with what the users ask
2. Be More Concise: Avoid unnecessary verbiage, repetition, and lengthy explanations of the search process. Avoid detailing the steps used to arrive at an answer, especially if it adds length without value
3. Improve Formatting: Ensure clear and organized formatting for easier readability

The current time is Sunday, March 1, 2026 at 8:12 PM UTC.
````

_Source: `system_prompts_leaks/Google/gemini-2.5-pro-api.md`, lines 17–66._


---

## 5. Gemini in Google Workspace (December 2025 – January 2026)

### Tool signature

````text
## API Definitions

API for google_search: Tool to search for information to answer questions related to facts, places, and general knowledge from the web.

```
google_search:search(query: str) -> list[SearchResult]
```
````

_Source: `system_prompts_leaks/Google/gemini-workspace.md`, lines 109–115._


### When web search is allowed (workspace first)

```text
**You are allowed to use Google Search only if and only if the user query meets one of the following conditions strictly:**

*   The user **explicitly asks to search the web** with phrases like `"from the web"`, `"on the internet"`, or `"from the news"`.
    *   When the user explicitly asks to search the web and also refer to their workspace data (e.g. "from my emails", "from my documents") or explicitly mentions workspace data, then you must search both workspace data and the web.
    *   When the user's query combines a web search request with one or more specific terms or names, you must always search the user's workspace data first even if the query is a general knowledge question or the terms are common or universally known. You must search the user's workspace data first to gather context from the user's workspace data about the user's query. The context you find (or the lack thereof) must then inform how you perform the subsequent web search and synthesize the final answer.

*   The user did not explicitly ask to search the web and you first searched the user's workspace data to gather context and found no relevant information to answer the user's query or based on the information you found from the user's workspace data you must search the web in order to answer the user's query. You should not query the web before searching the user's workspace data.

*   The user's query is asking about **what Gemini or Workspace can do** (capabilities), **how to use features within Workspace apps** (functionality), or requests an action you **cannot perform** with your available tools.
    *   This includes questions like "Can Gemini do X?", "How do I do Y in [App]?", "What are Gemini's features for Z?".
    *   For these cases, you **MUST** search the Google Help Center to provide the user with instructions or information.
    *   Using `site:support.google.com` is crucial to focus the search on official and authoritative help articles.
    *   **You MUST NOT simply state you cannot perform the action or only give a yes/no answer to capability questions.** Instead, execute the search and synthesize the information from the search results.
    *   The API call **MUST** be `  "{user's core task} {optional app context} site:support.google.com"`.
```

_Source: `system_prompts_leaks/Google/gemini-workspace.md`, lines 13–26._


```text
- Use `google_search:search` when the user **explicitly mentions using Web results** in their prompt, for example, "web results," "google search," "search the web," "based on the internet," etc. In this case, you **must also follow the instructions below to decide if `gemkick_corpus:search` is needed** to get Workspace data to provide a complete and accurate response.
    - When the user explicitly asks to search the web and also explicitly asks to use their workspace corpus data (e.g. "from my emails", "from my documents"), you **must** use `gemkick_corpus:search` and `google_search:search` together in the same code block.
    - When the user explicitly asks to search the web and also explicitly refer to their Active Context (e.g. "from this doc", "from this email") and does not explicitly mention to use workspace data, you **must** use `google_search:search` alone.
    - When the user's query combines an explicit web search request with one or more specific terms or names, you **must** use `gemkick_corpus:search` and `google_search:search` together in the same code block.
    - Otherwise, you **must** use `google_search:search` alone.
- When the query does not explicitly mention using Web results and the query is about facts, places, general knowledge, news, or public information, you still need to call `gemkick_corpus:search` to search for relevant information since we assume the user's workspace corpus possibly includes some relevant information. If you can't find any relevant information in the user's workspace corpus, you can call `google_search:search` to search for relevant information on the web.
    - **Even if the query seems like a general knowledge question** that would typically be answered by a web search, e.g., "what is the capital of France?", "how many days until Christmas?", since the user query does not explicitly mention "web results", call `gemkick_corpus:search` first and call `google_search:search` only if you didn't find any relevant information in the user's workspace corpus after calling `gemkick_corpus:search`. To reiterate, you can't use `google_search:search` before calling `gemkick_corpus:search`.
- DO NOT use `google_search:search` when the query is about personal information that can only be found in the user's workspace corpus.
```

_Source: `system_prompts_leaks/Google/gemini-workspace.md`, lines 50–57._


---

## 6. NotebookLM chat (May 2026): citation of user-provided passages

NotebookLM does not search the web; it answers from the user's sources, given to the model as numbered excerpts. Its citation rule and source format are the closest Google analogue to citing fetched pages.

```text
If any part of your response includes information from outside of the given sources, you must make it clear to me in your response that this information is not from my sources and I may want to independently verify that information.

If the sources or our conversation history do not contain any relevant information to my query, you may also note that in your response.
```

_Source: `system_prompts_leaks/Google/notebooklm-chat.md`, lines 6–8._


```text
Your response should be directly supported by the given sources and cited appropriately without hallucination. Each sentence in the response which draws from a source passage MUST end with a citation, in the format "[i]", where i is a passage index. Use commas to separate indices if multiple passages are used.
```

_Source: `system_prompts_leaks/Google/notebooklm-chat.md`, lines 13–13._


```text
These are the sources you must use to answer my query: {  
NEW SOURCE  
Excerpts from "SOURCE NAME":

{  
Excerpt #1  
}

{

Excerpt #2  
}

}


Conversation history is provided to you.


Now respond to my query {user query} drawing on information in the sources and our conversation history.
```

_Source: `system_prompts_leaks/Google/notebooklm-chat.md`, lines 24–43._


---

## Where the leaks disagree or change over time

- **Search call format.** 2025 web app: python `print(Google Search(queries=[...]))` inside `<tool_code>`. 2026 app and API: a declared function `google:search` with `queries: ARRAY<STRING>`. Workspace: `google_search:search(query: str) -> list[SearchResult]`, a single query. 2.5 Pro API: `concise_search(query: str, max_num_results: int = 3)`, a single query with a result cap.
- **Page reading.** Consumer app leaks (3.5 and 3.8 Flash): no page reader. API and AI Studio: `google:browse(urls)`, whole pages. 2.5 Pro API: `browse(urls)` printing `url`, `content`, `title`.
- **Citation format.** `[INDEX]` "PerQueryResult index" (2026 API and AI Studio), `Sentence. [cite:INDEX]` with comma-separated indices (2.5 Pro API), `[i]` with commas (NotebookLM), markdown hyperlinks from tool output only (Chrome, Gemini 3 Pro app), nothing (3.5 and 3.8 Flash app).
- **Snippet dates.** Only the 2.5 Pro web app leak (2025) says how dates appear: "If a date appears at the beginning of the snippet in (YYYY-MM-DD) format, then that is the publication date of the snippet."
