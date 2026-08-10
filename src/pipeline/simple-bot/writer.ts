/**
 * The simple bot's writer.
 *
 * It asks the model for one community note together with the sources that note
 * cites. The writer trusts the earlier search step's decision that a correction
 * is needed. It does not check that again here.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { lintWriterNote } from "../utils/noteLint";
import { runJsonLlmCall, type ChatMessage } from "../utils/jsonLlmCall";
import {
  WRITER_SYSTEM_PROMPT,
  WRITER_FEWSHOT_EXAMPLES,
  WRITER_TIME_TRAVEL_RULE,
  WRITER_RESPONSE_FORMAT,
  MISINFO_SOURCING_RULE,
  MISINFO_NOTE_SHAPE_RULE,
  MISINFO_CONCEDE_SHAPE_RULE,
  buildWriterUserMessage,
  buildWriterRetryMessage,
  buildWriterLintMessage,
} from "../prompts/simple-bot/writer";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";

export interface WriterResult {
  noteText: string;
  sources: string[];
}

const MAX_WRITER_ATTEMPTS = 3;
const MAX_NOTE_CHARS = 280;

export async function runWriter(
  userMessage: string,
  findings: string,
  opts?: { timingContext?: string },
): Promise<WriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const monitoring = getMonitoringContext();
  let systemPrompt = config.writer_examples ? WRITER_SYSTEM_PROMPT + WRITER_FEWSHOT_EXAMPLES : WRITER_SYSTEM_PROMPT;
  if (config.time_travel_prompt) systemPrompt += WRITER_TIME_TRAVEL_RULE;
  if (opts?.timingContext) log?.set("writer.timingContext", true);

  // On a curated misinfo topic we prepend the topic's vetted in-group and
  // primary sources to the findings, so the writer can actually cite them. We
  // also tell the writer to prefer them over the mainstream outlets this
  // audience distrusts, and we constrain the shape of the note to one
  // correction with one or two sources. A regular note is left untouched.
  let effectiveFindings = findings;
  if (monitoring) {
    systemPrompt += MISINFO_SOURCING_RULE + MISINFO_NOTE_SHAPE_RULE;
    // Concede-then-correct experiment. The flag is only ever true on the "on"
    // arm of the 50/50 MISINFO_CONCEDE_SHAPE_TEST, which fires only on topics
    // enrolled in CONCEDE_SHAPE_TOPIC_IDS.
    if (config.concede_shape) {
      systemPrompt += MISINFO_CONCEDE_SHAPE_RULE;
      log?.set("writer.concedeShape", true);
    }
    effectiveFindings = `${buildReferenceBlock(monitoring)}\n\n${findings}`;
    log?.set("writer.misinfoSourcing", true);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildWriterUserMessage(userMessage, effectiveFindings) + (opts?.timingContext ?? "") },
  ];

  // runJsonLlmCall owns the JSON parse and its own re-ask loop. This loop adds
  // the note's own validation on top and re-asks the writer on the same thread.
  // The length is counted the way the note will actually be submitted, which is
  // the body plus the appended source URLs, with each URL counting as one
  // character. So a body of 280 characters or fewer can still overflow once the
  // sources are appended. An empty note means the writer found no dispute. It
  // is never linted and returns below. On a curated topic the lint also checks
  // the number of sources, the form of each URL, and bare domains in the body.
  // A regular note keeps only the length rule, and its feedback and error text
  // are unchanged.
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
    const { charCount, problems } = lintWriterNote({
      noteText,
      sources,
      maxChars: MAX_NOTE_CHARS,
      topicRules: monitoring !== undefined,
    });

    log?.set(`${logPrefix}.response`, { note_text: noteText, sources });
    log?.set(`${logPrefix}.charCount`, charCount);

    if (problems.length === 0) {
      return { noteText, sources };
    }
    log?.set("writer.lint", problems);

    const lengthOnly = problems.every((p) => p.kind === "length");
    if (attempt >= MAX_WRITER_ATTEMPTS) {
      throw new Error(
        lengthOnly
          ? `simple-bot writer exceeded ${MAX_NOTE_CHARS} char limit after ${MAX_WRITER_ATTEMPTS} attempts (last: ${charCount} chars incl. sources)`
          : `simple-bot writer failed note lint after ${MAX_WRITER_ATTEMPTS} attempts: ${problems.map((p) => p.message).join("; ")}`,
      );
    }

    messages.push({ role: "assistant", content: JSON.stringify(parsed) });
    messages.push({
      role: "user",
      content: lengthOnly
        ? buildWriterRetryMessage({ charCount, maxChars: MAX_NOTE_CHARS, noteText })
        : buildWriterLintMessage({ problems: problems.map((p) => p.message), noteText }),
    });
  }

  throw new Error("unreachable");
}
