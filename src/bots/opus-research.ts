/**
 * Opus Research Bot
 *
 * Research bot that uses Grok for initial X/Twitter search, then Claude for everything else.
 * Flow:
 * 1. Grok searches X for context (parallel with Claude's first search)
 * 2. Claude analyzes gaps and does follow-up research (1-2 rounds)
 * 3. Claude writes the note from accumulated research
 * 4. Claude checks the note against its source
 */

import { Bot, PipelineResult } from "./types";
import { verifySource } from "../pipeline/sourceVerification";
import {
  searchXWithGrok,
  extractGrokQuotedTweet,
  compareQuotedTweets,
} from "../pipeline/grokSearch";
import { claudeFirstSearch, followUpResearch } from "../pipeline/researchLoop";
import { writeNoteFn as writeNote } from "../pipeline/writeNote";

const MODELS = {
  grokSearch: "grok-4-fast",
  research: "anthropic/claude-opus-4.6",
  analysis: "anthropic/claude-opus-4.6",
  noteWriting: "anthropic/claude-opus-4.6",
  checking: "anthropic/claude-opus-4.6",
};

export const opusResearch: Bot = {
  id: "opus-research",
  name: "Opus 4.6 + Grok X Search",
  description:
    "Research bot: Grok for initial X search, Claude Opus 4.6 for analysis and note writing",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    const allResearch: string[] = [];
    let collectedUrls: string[] = [];

    try {
      // 1. Run Grok X search and Claude first search IN PARALLEL
      // Grok failure is non-fatal; Claude failure aborts the pipeline
      console.log(`[${this.id}] Starting parallel searches (Grok + Claude)...`);
      lastStage = "parallel_search";
      const [grokSettled, claudeFirstResult] = await Promise.all([
        searchXWithGrok(post.id, content.text, { model: MODELS.grokSearch })
          .catch((err) => {
            console.warn(`[${this.id}] Grok search failed (continuing without it):`, err?.message || err);
            return null;
          }),
        claudeFirstSearch(content.text, { model: MODELS.research }, content.quotedPostContext),
      ]);
      const grokResult = grokSettled;
      if (grokResult) {
        allResearch.push(`--- Grok X Search ---\n${grokResult}`);
      }
      allResearch.push(`--- Claude Initial Research ---\n${claudeFirstResult}`);
      console.log(`[${this.id}] Parallel searches complete (Grok: ${grokResult ? "ok" : "failed"})`);

      // 2. Compare Grok's quoted tweet with our quotedPostContext (warning only)
      if (grokResult) {
        const grokQuotedTweet = extractGrokQuotedTweet(grokResult);
        const quoteMismatch = compareQuotedTweets(grokQuotedTweet, content.quotedPostContext);
        if (quoteMismatch) {
          console.warn(`[${this.id}] Quote tweet mismatch (continuing): ${quoteMismatch}`);
          allResearch.push(`--- Quote Tweet Mismatch Warning ---\n${quoteMismatch}`);
        }
      }

      // 3. First follow-up research - analyze and extract URLs
      console.log(`[${this.id}] Claude follow-up research (round 1)...`);
      lastStage = "follow_up_1";
      const followUp1 = await followUpResearch(
        content.text,
        allResearch.join("\n\n"),
        1,
        { model: MODELS.analysis },
        content.quotedPostContext,
        grokResult ?? undefined
      );
      allResearch.push(`--- Claude Follow-up 1 ---\n${followUp1.content}`);
      collectedUrls.push(...followUp1.urls);
      console.log(`[${this.id}] URLs found: ${followUp1.urls.length}`);

      // 4. Optional second follow-up - only if more research needed
      if (followUp1.hasGaps) {
        console.log(`[${this.id}] More research needed: ${followUp1.researchRequest}`);

        lastStage = "follow_up_2";
        const followUp2 = await followUpResearch(
          content.text,
          allResearch.join("\n\n"),
          2,
          { model: MODELS.analysis },
          content.quotedPostContext,
          grokResult ?? undefined
        );
        allResearch.push(`--- Claude Follow-up 2 ---\n${followUp2.content}`);
        collectedUrls.push(...followUp2.urls);

        if (!followUp2.hasGaps) {
          console.log(`[${this.id}] Satisfied after follow-up 2, proceeding to note writing`);
        } else {
          console.log(`[${this.id}] Still has gaps but proceeding (max iterations reached)`);
        }
      } else {
        console.log(`[${this.id}] No additional research needed, proceeding to note writing`);
      }

      // 5. Write note with all accumulated research
      console.log(`[${this.id}] Writing note with ${allResearch.length} research rounds...`);
      const combinedResearch = allResearch
        .map((r, i) => `--- Research Round ${i + 1} ---\n${r}`)
        .join("\n\n");
      lastStage = "note_writing";
      const noteResult = await writeNote(
        {
          text: content.text,
          searchResults: combinedResearch,
          citations: collectedUrls,
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.noteWriting }
      );

      // 6. Check the note
      lastStage = "check";
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
        lastStage,
        searchContextResult: {
          text: content.text,
          searchResults: allResearch.join("\n\n---\n\n"),
          citations: collectedUrls,
        },
        noteResult,
        checkResult,
      };
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: {
          text: content.text,
          searchResults: allResearch.join("\n\n") || "",
          citations: collectedUrls,
        },
        noteResult: { note: "", url: "", status: "ERROR" },
        checkResult: "",
        error: err?.message || String(err),
      };
    }
  },
};
