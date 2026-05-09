/**
 * Opus Main v2 + Grok Bot
 *
 * Same as opus-main-v2 (URL-aware char counting) but with Grok X search
 * running in parallel with Perplexity for richer tweet context.
 */

import { Bot, PipelineResult } from "./types";
import { enrichedSearch } from "../pipeline/search/enrichedSearch";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { verifySource } from "../pipeline/verify/sourceVerification";
import { analyzeMedia } from "../pipeline/media/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  grokSearch: "grok-4-fast",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMainV2Grok: Bot = {
  id: "opus-main-v2-grok",
  name: "Opus 4.5 (Main v2 + Grok)",
  description: "Opus Main v2 with Grok X search for tweet context",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    const warnings: string[] = [];

    // Media analysis (non-fatal — continues without it but records warning)
    let mediaContext = "";
    if (content.mediaItems?.length) {
      try {
        const mediaResult = await analyzeMedia(content.mediaItems, {
          visionModel: MODELS.vision,
        });
        mediaContext = mediaResult.contextForSearch;
        if (mediaResult.warnings.length > 0) {
          warnings.push(...mediaResult.warnings);
        }
      } catch (err: any) {
        const msg = `Media analysis failed: ${err.message}`;
        const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
        if (strippedText.length < 20) {
          throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
        }
        console.warn(`[${this.id}] ${msg} (continuing without media context)`);
        warnings.push(msg);
      }
    }

    const searchResult = await enrichedSearch(
      {
        text: content.text,
        media: content.media,
        searchResults: mediaContext,
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
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
