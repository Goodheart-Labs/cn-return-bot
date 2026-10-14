/**
 * Collects the prompts of every model step of the Common Notes pipeline into
 * prompts.json, for the pipeline diagram. The prompts of the extraction steps
 * come from the code. The prompts of the claim check come from the saved log of
 * the lab's baseline run of 29 September, because the claim check builds them
 * deep inside the X note pipeline. That log is a snapshot of what was sent.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/pipelineDiagram/collectPrompts.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { GATE_SPLIT_SYSTEM_PROMPT } from "../../../everything/pipeline/gateAndSplit";
import { extractionSystemPrompt } from "../../../everything/pipeline/extractClaims";
import { RATING_SYSTEM_PROMPT } from "../../../everything/pipeline/rateClaims";
import { IMAGE_PROMPT } from "../../../pipeline/prompts/media/mediaAnalysis";
import { MATERIALITY_JUDGE_SYSTEM_PROMPT } from "../../../pipeline/prompts/simple-bot/materialityJudge";
import { SEARCH_SYSTEM_PROMPT_CLAIM } from "../../../pipeline/prompts/simple-bot/searchAgent";
import { TIMING_EXTRACTOR_SYSTEM_PROMPT } from "../../../pipeline/prompts/simple-bot/timingJudge";
import { LAB_DIR } from "../runStore";

const LOG_RUN = "2026-09-29-1011";
/** A claim whose check went all the way to a writer and a source check. */
const CLAIM_WITH_NOTE_STEPS = 122;
/** A claim whose check ended after the research. */
const CLAIM_ENDED_AT_RESEARCH = 175;

const readLog = (index: number) => JSON.parse(readFileSync(join(LAB_DIR, "logs", LOG_RUN, `${index}.json`), "utf8")).logs;
const first = (messages: Record<string, any>) => messages["0"] as { systemPrompt: string; userMessage: string };

const full = readLog(CLAIM_WITH_NOTE_STEPS);
const short = readLog(CLAIM_ENDED_AT_RESEARCH);
/** The saved log was written before the claim check input became the point alone. */
const withPointAlone = (message: string) => message.replace(/Highlighted claim from Article:([^\n]*)\nSurrounding context:[^\n]*/g, "Passage from Article:$1");
const writerMessages = full.note_writer_steps.note_writer.attempts["0"].messages as { role: string; content: string }[];

writeFileSync(
  join(LAB_DIR, "pipelineDiagram", "prompts.json"),
  JSON.stringify(
    {
      collectedFrom: `The extraction prompts and the research system prompt come from the code. The other claim check prompts come from the lab's run of 29 September (${LOG_RUN}).`,
      system: {
        gate: GATE_SPLIT_SYSTEM_PROMPT,
        images: IMAGE_PROMPT,
        extraction: extractionSystemPrompt(),
        rating: RATING_SYSTEM_PROMPT,
        topic: first(short.topic_filter.messages).systemPrompt,
        research: SEARCH_SYSTEM_PROMPT_CLAIM,
        timing: TIMING_EXTRACTOR_SYSTEM_PROMPT,
        writer: writerMessages.find((m) => m.role === "system")!.content,
        verifier: first(full.note_writer_steps.source_verifier.turn["1"].messages).systemPrompt,
        materiality: MATERIALITY_JUDGE_SYSTEM_PROMPT,
      },
      user: {
        research: withPointAlone(first(short.note_writer_steps.search.messages).userMessage),
        writer: withPointAlone(writerMessages.find((m) => m.role === "user")!.content),
        verifier: withPointAlone(first(full.note_writer_steps.source_verifier.turn["1"].messages).userMessage),
      },
    },
    null,
    1,
  ),
);
console.log("Wrote prompts.json");
