/**
 * Experiment 13: News search for "Scott Alexander" with 5 or 10 results did not
 * return the panel story 2105813967801070019. Ask for 20 results over 24 hours and
 * report where, if anywhere, it ranks. At most 20 stories, $0.10.
 */
import { xGet } from "./x";

const PANEL_STORY = "2105813967801070019";
const result = await xGet("/2/news/search", { query: "Scott Alexander", max_results: 20, max_age_hours: 24, "news.fields": "name,updated_at" }, "user", "13_search_rank");
const stories = result.body.data ?? [];
const position = stories.findIndex((s: any) => s.id === PANEL_STORY);
console.log(`${result.status}: ${stories.length} stories, panel story at position ${position === -1 ? "none" : position + 1}`);
