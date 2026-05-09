/**
 * Opus Verified Bot
 *
 * High-quality bot that trades volume for accuracy. Uses every quality signal
 * available before submitting:
 *
 * 1. Sonar Pro search (deeper than standard Sonar)
 * 2. Deep fact verification (claims analysis → targeted follow-ups → model validation)
 * 3. Write note with enriched context from verification
 * 4. Check note against source
 * 5. Source trustworthiness gate (reject low-trust sources)
 * 6. Scoring filters gate (all 3 must pass)
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as search } from "../pipeline/search/searchContextGoal";
import { deepFactVerification } from "../pipeline/search/deepFactVerification";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { verifySource } from "../pipeline/verify/sourceVerification";
import { scoreSourceTrustworthiness } from "../pipeline/verify/sourceTrustworthiness";
import {
  runNoteScores,
  checkAllThresholds,
  type AllNoteScores,
} from "../pipeline/score/noteScores";

const MODELS = {
  search: "perplexity/sonar-pro",
  deepVerification: "anthropic/claude-opus-4.6",
  noteWriting: "anthropic/claude-opus-4.6",
  checking: "anthropic/claude-opus-4.6",
  scoring: "anthropic/claude-sonnet-4",
};

export const opusVerified: Bot = {
  id: "opus-verified",
  name: "Opus 4.6 Verified",
  description:
    "High-quality bot: deep fact verification + source trust gate + scoring filters",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    let scoringResults: AllNoteScores | undefined;

    try {
      // 1. Sonar Pro search
      console.log(`[${this.id}] Searching with Sonar Pro...`);
      lastStage = "search";
      const searchResult = await search(
        {
          text: content.text,
          media: content.media,
          mediaContext: "",
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.search }
      );

      // 2. Deep fact verification — enriches context before note writing
      console.log(`[${this.id}] Running deep fact verification...`);
      lastStage = "deep_verification";
      const verification = await deepFactVerification(
        {
          text: content.text,
          media: content.media,
          initialSearchResults: searchResult.searchResults,
          initialCitations: searchResult.citations || [],
        },
        {
          analysisModel: MODELS.deepVerification,
          maxFollowUpQueries: 2,
          validateModel: true,
        }
      );
      console.log(
        `[${this.id}] Verification complete: ${verification.claimAnalysis.keyClaims.length} claims, ${verification.allCitations.length} total citations`
      );

      // 3. Write note with enriched context
      console.log(`[${this.id}] Writing note with enriched context...`);
      lastStage = "note_writing";
      const noteResult = await writeNote(
        {
          text: content.text,
          searchResults: verification.combinedContext,
          citations: verification.allCitations,
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.noteWriting }
      );

      // Early return if no correction needed
      if (noteResult.status !== "CORRECTION WITH TRUSTWORTHY CITATION") {
        console.log(
          `[${this.id}] No correction needed (status: ${noteResult.status})`
        );
        return {
          post,
          botId: this.id,
          lastStage,
          searchContextResult: {
            text: content.text,
            searchResults: verification.combinedContext,
            citations: verification.allCitations,
            quotedPostContext: content.quotedPostContext,
          },
          noteResult,
          checkResult: "",
        };
      }

      // 4. Check note against source
      console.log(`[${this.id}] Checking note against source...`);
      lastStage = "check";
      const checkResult = await verifySource(
        { note: noteResult.note, url: noteResult.url, status: noteResult.status },
        { model: MODELS.checking }
      );

      // 5. Source trustworthiness gate (free — pure logic, no LLM call)
      lastStage = "source_trust";
      const trustScore = scoreSourceTrustworthiness(noteResult.url);
      console.log(
        `[${this.id}] Source trust: ${trustScore.domain} = ${trustScore.score} (${trustScore.tier})`
      );
      if (trustScore.score < 0.5) {
        console.log(
          `[${this.id}] Source trust too low (${trustScore.score} < 0.5) — rejecting`
        );
        return {
          post,
          botId: this.id,
          lastStage: "source_trust",
          searchContextResult: {
            text: content.text,
            searchResults: verification.combinedContext,
            citations: verification.allCitations,
            quotedPostContext: content.quotedPostContext,
          },
          noteResult: { ...noteResult, status: "SOURCE_TRUST_FAILED" },
          checkResult,
        };
      }

      // 6. Scoring filters gate (3 parallel LLM calls)
      console.log(`[${this.id}] Running scoring filters...`);
      lastStage = "scoring";
      scoringResults = await runNoteScores(
        noteResult.note,
        content.text,
        verification.combinedContext,
        noteResult.url,
        MODELS.scoring
      );

      const allPassed = checkAllThresholds(scoringResults);
      if (!allPassed) {
        console.log(`[${this.id}] Scoring filters failed — rejecting`);
        const result: PipelineResult = {
          post,
          botId: this.id,
          lastStage,
          searchContextResult: {
            text: content.text,
            searchResults: verification.combinedContext,
            citations: verification.allCitations,
            quotedPostContext: content.quotedPostContext,
          },
          noteResult: { ...noteResult, status: "SCORING_FILTERS_FAILED" },
          checkResult,
        };
        (result as any).scoringResults = scoringResults;
        return result;
      }

      console.log(`[${this.id}] All gates passed — note ready for submission`);
      const result: PipelineResult = {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: {
          text: content.text,
          searchResults: verification.combinedContext,
          citations: verification.allCitations,
          quotedPostContext: content.quotedPostContext,
        },
        noteResult,
        checkResult,
      };
      (result as any).scoringResults = scoringResults;
      return result;
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      throw err;
    }
  },
};
