/**
 * The second research round.
 *
 * When the source verifier rejects a note, the research step gets one more turn.
 * It sees its own findings, the note that was written from them and everything
 * the verifier said, and writes revised findings. In the evals this fixed most
 * of the notes that claimed more than their sources said. The same research
 * model does the revision as did the first research: the quick model stays the
 * quick model and the stronger model stays the stronger one.
 * SECOND_ROUND_TEST in abTestsData.ts switches it on.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { STEP } from "../utils/noteWriterSteps";
import type { SourceVerification } from "../verify/sourceVerifier";
import { CASCADE_NO_NOTE_BELOW, runQuickSearch, runStrongSearch } from "./cascadeSearch";
import { runSearch } from "./search";

export interface SecondRoundInput {
  /** The message the first research was given, unchanged. */
  userMessage: string;
  /** The findings that the writer wrote the rejected note from. */
  findings: string;
  researchedBy: "quick" | "full";
  noteText: string;
  verification: SourceVerification;
}

/** The first message plus the first findings, the note and the verifier's answer, with what to do about them. */
export function secondRoundMessage(input: SecondRoundInput): string {
  const { verification } = input;
  const verifierAnswer = {
    accepted: verification.accepted,
    reasoning: verification.reasoning,
    sources: verification.source_evaluations ?? { good: verification.good_sources, bad: verification.bad_sources },
  };
  return `${input.userMessage}

## Your earlier research
${input.findings}

## What happened to it
A source checker opened the pages you cited and rejected the note that was written from your findings. Its full answer is below.

Write revised research findings, in the same format as before. Keep what the checker confirmed. Remove or reword every claim that no fetched page supports. For a page that could not be fetched, find another page that says the same thing and can be opened, and cite that instead. Cite only pages whose text states what you rely on.

### The note that was written from your findings
${input.noteText}

### The source checker's answer
${JSON.stringify(verifierAnswer, null, 1)}`;
}

/** Revised findings, and whether the research now says no note is needed. */
export async function reviseResearch(input: SecondRoundInput): Promise<{ findings: string; withdrew: boolean }> {
  const message = secondRoundMessage(input);
  if (input.researchedBy === "quick") {
    const quick = await runQuickSearch(message, `${STEP.root}.second_round_research`);
    return { findings: quick.findings, withdrew: quick.probability < CASCADE_NO_NOTE_BELOW };
  }
  const search = await (getBotConfig().search_cascade ? runStrongSearch(message) : runSearch(message));
  return { findings: search.findings, withdrew: !search.correctionNeeded };
}
