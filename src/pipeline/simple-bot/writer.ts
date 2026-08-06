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
import { lintWriterNote } from "../utils/noteLint";
import { runJsonLlmCall, type ChatMessage } from "../utils/jsonLlmCall";
import {
  WRITER_SYSTEM_PROMPT,
  WRITER_FEWSHOT_EXAMPLES,
  WRITER_TIME_TRAVEL_RULE,
  WRITER_RESPONSE_FORMAT,
  MISINFO_SOURCING_RULE,
  MISINFO_NOTE_SHAPE_RULE,
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

  // Curated misinfo topic: prepend the topic's vetted in-group / primary sources
  // to the findings (so the writer can actually cite them), steer it to prefer
  // them over mainstream outlets this audience distrusts, and constrain the
  // note's shape (one correction, 1-2 sources). Regular notes: untouched.
  let effectiveFindings = findings;
  if (monitoring) {
    systemPrompt += MISINFO_SOURCING_RULE + MISINFO_NOTE_SHAPE_RULE;
    effectiveFindings = `${buildReferenceBlock(monitoring)}\n\n${findings}`;
    log?.set("writer.misinfoSourcing", true);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildWriterUserMessage(userMessage, effectiveFindings) + (opts?.timingContext ?? "") },
  ];

  // The helper owns the JSON parse + re-ask loop; this loop layers the note's
  // own validation on top, re-asking the writer on the same thread. Length is
  // counted as the note will actually be submitted: body + appended source
  // URLs (each URL counts as 1 char) — the body alone can be ≤280 yet overflow
  // once sources are appended. An empty note (no dispute found) is never
  // linted and returns below. Curated topics get the additional shape checks
  // (source count / URL form / bare domains); regular notes keep the length
  // rule only, with unchanged feedback and error text.
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
