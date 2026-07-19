/**
 * Simple Bot — Writer
 *
 * Single LLM call that produces one community note + its cited sources. The
 * writer trusts the upstream search decision that a correction IS needed; it
 * does not re-check that here.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { countSubmittedNoteLength } from "../utils/noteLength";
import { runJsonLlmCall, type ChatMessage } from "../utils/jsonLlmCall";
import {
  WRITER_SYSTEM_PROMPT,
  SIMPLE_WRITER_SYSTEM_PROMPT,
  WRITER_FEWSHOT_EXAMPLES,
  WRITER_RESPONSE_FORMAT,
  MISINFO_SOURCING_RULE,
  buildWriterUserMessage,
  buildWriterRetryMessage,
} from "../prompts/simple-bot/writer";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";

export interface WriterResult {
  noteText: string;
  sources: string[];
}

const MAX_WRITER_ATTEMPTS = 3;
const MAX_NOTE_CHARS = 280;

export async function runWriter(userMessage: string, findings: string): Promise<WriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const monitoring = getMonitoringContext();
  const basePrompt = config.simple_prompts ? SIMPLE_WRITER_SYSTEM_PROMPT : WRITER_SYSTEM_PROMPT;
  let systemPrompt = config.writer_examples ? basePrompt + WRITER_FEWSHOT_EXAMPLES : basePrompt;

  // Curated misinfo topic: prepend the topic's vetted in-group / primary sources
  // to the findings (so the writer can actually cite them) and steer it to prefer
  // them over mainstream outlets this audience distrusts. Regular notes: untouched.
  let effectiveFindings = findings;
  if (monitoring) {
    systemPrompt += MISINFO_SOURCING_RULE;
    effectiveFindings = `${buildReferenceBlock(monitoring)}\n\n${findings}`;
    log?.set("writer.misinfoSourcing", true);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildWriterUserMessage(userMessage, effectiveFindings) },
  ];

  // The helper owns the JSON parse + re-ask loop; this loop layers the note's
  // own length validation on top, re-asking the writer on the same thread.
  for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
    const logPrefix = `${STEP.noteWriter}.attempts.${attempt - 1}`;
    log?.set(`${logPrefix}.messages`, messages);

    const parsed = await runJsonLlmCall<{ note_text: string; sources: string[] }>({
      costName: `${COST.noteWriter}.${attempt}`,
      model: config.writer_model ?? config.model,
      messages,
      responseFormat: WRITER_RESPONSE_FORMAT,
      schemaHint: `{ "note_text": string, "sources": string[] }`,
    });
    const noteText = parsed.note_text ?? "";
    const sources = parsed.sources ?? [];
    // Count the note as it will actually be submitted: body + appended source
    // URLs (each URL counts as 1 char). The body alone can be ≤280 yet overflow
    // once sources are appended — that's how a 284-char note reached X and was
    // rejected. An empty note (no dispute found) counts as 0 and returns below.
    const charCount = countSubmittedNoteLength(noteText, sources);

    log?.set(`${logPrefix}.response`, { note_text: noteText, sources });
    log?.set(`${logPrefix}.charCount`, charCount);

    if (charCount <= MAX_NOTE_CHARS) {
      return { noteText, sources };
    }

    if (attempt >= MAX_WRITER_ATTEMPTS) {
      throw new Error(
        `simple-bot writer exceeded ${MAX_NOTE_CHARS} char limit after ${MAX_WRITER_ATTEMPTS} attempts (last: ${charCount} chars incl. sources)`,
      );
    }

    messages.push({ role: "assistant", content: JSON.stringify(parsed) });
    messages.push({
      role: "user",
      content: buildWriterRetryMessage({ charCount, maxChars: MAX_NOTE_CHARS, noteText }),
    });
  }

  throw new Error("unreachable");
}
