/** One prompt per tool call. Each asks Muse to run exactly the call GPT made
 *  and to paste what its tool showed, without a summary of its own. */

export const SEARCH_PROMPT = (query: string) => `Run exactly one web search with this query, and no other query:

${query}

Then paste the search results exactly as your search tool showed them to you, word for word with the line numbers. After that, add one line per result with its number and its full URL, like "【0】 https://...". Do not open any page. Do not summarise, judge or add anything else of your own.`;

export const OPEN_PAGE_PROMPT = (url: string, line?: number) => `Open this page with your browser tool${line === undefined ? "" : `, starting at line ${line}`}:

${url}

Then paste the text of the page exactly as your tool showed it to you, word for word with the line numbers, from the first line you saw to the last. If you could not open it, say only "COULD NOT OPEN" and why. Do not search for anything else. Do not summarise, judge or add anything of your own.`;

export const FIND_IN_PAGE_PROMPT = (url: string, pattern: string) => `Open this page with your browser tool:

${url}

Then use your find tool to find every place on it that contains this exact text:

${pattern}

Paste what the find tool showed you, word for word with the line numbers. If the text is not on the page, say only "NO MATCH". If you could not open the page, say only "COULD NOT OPEN" and why. Do not search for anything else. Do not summarise, judge or add anything of your own.`;

export const SEARCH_WITH_URLS_PROMPT = (query: string) => `Run exactly one web search with this query, and no other query:

${query}

Then call lookup_citation_url on every single search result, to get each result's full URL.

Then paste the search results exactly as your search tool showed them to you, word for word with the line numbers, but in each result's marker replace the domain with the full URL. For example 【0†Title†example.com】 becomes 【0†Title†https://example.com/the/full/path】. Do not open any page. Do not summarise, judge or add anything else of your own.`;

export const LIST_TOOLS_PROMPT = `Without running any search, list the exact names of every tool and every browser action you can call, one per line. Say nothing else.`;

export const SEARCH_THEN_LOOKUP_LIST_PROMPT = (query: string) => `Run exactly one web search with this query, and no other query:

${query}

Then paste the search results exactly as your search tool showed them to you, word for word with the line numbers.

Then, for every result id in those results (0, 1, 2 and so on), call lookup_citation_url with that id. Under the pasted results, write one line per result: its id and the full URL that lookup_citation_url returned, like "【0】 https://example.com/the/full/path". Do not open any page. Do not summarise, judge or add anything else of your own.`;

export const SEARCH_THEN_CITE_PROMPT = (query: string) => `Run exactly one web search with this query, and no other query:

${query}

Then paste the search results exactly as your search tool showed them to you, word for word with the line numbers.

Then, under the pasted results, write one line per result with its id and its title, and cite that result on its line with your usual citation, so that every single result is cited once. Do not open any page. Do not summarise, judge or add anything else of your own.`;

export const SEARCH_THEN_MARKER_PROMPT = (query: string) => `Run exactly one web search with this query, and no other query:

${query}

Then paste the search results exactly as your search tool showed them to you, word for word with the line numbers.

Then, under the pasted results, write one line per result: its id, its title, and a citation marker of the form 【<page id>†L<line>】, where <page id> is the number in square brackets at the top of the search results page and <line> is the line number of that result's 【id†…】 line. Do not open any page. Do not summarise, judge or add anything else of your own.`;
