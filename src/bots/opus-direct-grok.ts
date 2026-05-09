/**
 * Opus Direct + Grok Bot
 *
 * Same as opus-direct (punchy, fact-first writing style) but with Grok X search
 * running in parallel with Perplexity. Grok provides real-time X/Twitter context
 * (thread, quoted tweets, replies) which helps identify primary sources.
 */

import { Bot, PipelineResult } from "./types";
import { enrichedSearch } from "../pipeline/search/enrichedSearch";
import { writeNoteDirectFn as writeNote } from "../pipeline/write/writeNoteDirect";
import { verifySource } from "../pipeline/verify/sourceVerification";

const MODELS = {
  search: "perplexity/sonar-pro",
  grokSearch: "grok-4-fast",
  noteWriting: "anthropic/claude-opus-4.6",
  checking: "anthropic/claude-opus-4.6",
};

export const opusDirectGrok: Bot = {
  id: "opus-direct-grok",
  name: "Opus 4.6 Direct + Grok",
  description: "Direct style bot with Grok X search for tweet context",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    const searchResult = await enrichedSearch(
      {
        text: content.text,
        media: content.media,
        searchResults: "",
        quotedPostContext: content.quotedPostContext,
      },
      { perplexityModel: MODELS.search, grokModel: MODELS.grokSearch },
      post.id
    );

    const noteResult = await writeNote(
      {
        text: searchResult.text,
        searchResults: searchResult.searchResults,
        citations: searchResult.citations || [],
      },
      { model: MODELS.noteWriting }
    );

    const checkResult = await verifySource(
      {
        note: noteResult.note,
        url: noteResult.url,
        status: noteResult.status,
      },
      { model: MODELS.checking }
    );

    return {
      post,
      botId: this.id,
      searchContextResult: searchResult,
      noteResult,
      checkResult,
    };
  },
};
