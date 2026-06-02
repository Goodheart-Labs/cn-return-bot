/**
 * Simple Bot — Writer
 *
 * Single LLM call that produces one community note + its cited sources. The
 * writer trusts the upstream search decision that a correction IS needed; it
 * does not re-check that here.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { countNoteLength } from "../write/writeNote";
import { ModelOutputInvalidError } from "../utils/errors";
import { stripJsonFences } from "../utils/jsonOutput";

export interface WriterResult {
  noteText: string;
  sources: string[];
}

const MAX_WRITER_ATTEMPTS = 3;
const MAX_NOTE_CHARS = 280;

const SYSTEM_PROMPT = `You are a Community Notes writer for X/Twitter. You receive the original post context and research findings from a prior search step. Your job: write exactly one community note that disputes a specific factual claim in the post — or return an empty note if you cannot find one to dispute.

## The one rule

**Your note must DISPUTE something the tweet asserts.** If the research findings do not contain evidence that contradicts a specific claim in the tweet, return an empty note — do NOT write a note that:
- Restates the tweet's claim in different words
- Adds adjacent context that doesn't contradict anything (e.g. tweet says X happened, you say X was later partially reversed — that's not a dispute)
- Cites a source that *agrees* with the tweet as if you're correcting it
- Asserts specifics (locations, dates, who-said-what, URLs) that don't appear verbatim in the findings — never fabricate

Empty note means: \`note_text\` = "" and \`sources\` = []. The downstream judge will record "no_correction_needed" and we move on. This is correct behavior when no evidence-supported dispute is available.

## Note style
- Lead with what IS true, not "The post claims..." or "This is false"
  GOOD: "This video was recorded in January 2024 during a murder trial."
  BAD: "The post falsely claims that..."
- One key fact. Pick the single strongest piece of evidence.
- 1-2 sentences before the URL. Short and direct.
- No hedging: don't say "appears to", "seems to", "potentially"
- Neutral, bridging tone: people who agree AND disagree with the post should both find it fair
- No sarcasm, no "gotcha" framing, no partisan language
- Prefer primary sources (official sites, X posts, Wikipedia, YouTube originals) over news articles

## Character limit
- Target: 240-260 non-URL characters
- Hard max: 280 non-URL characters (URLs are shortened by X and count as 1 character each)
- Be concise. Every word must earn its place.

## Source rules
- Every source must DIRECTLY support your specific correction (not just general background)
- Don't add redundant sources
- Tweets or tweet replies can be valid sources
- Pull source URLs from the research findings — do not invent URLs`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "simple_bot_note",
    strict: true,
    schema: {
      type: "object",
      properties: {
        note_text: {
          type: "string",
          description: "The community note body (do not include source URLs here; they go in `sources`).",
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Full https:// URLs cited by the note.",
        },
      },
      required: ["note_text", "sources"],
      additionalProperties: false,
    },
  },
};

export async function runWriter(userMessage: string, findings: string): Promise<WriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const combinedUserMessage = `${userMessage}\n\n## Research findings\n\n${findings}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: combinedUserMessage },
  ];

  for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
    const logPrefix = `${STEP.noteWriter}.attempts.${attempt - 1}`;
    log?.set(`${logPrefix}.messages`, messages);

    const { response, costEntry } = await trackedLlmCreate(`simpleBot.writer.${attempt}`, {
      model: config.writer_model ?? config.model,
      messages,
      response_format: RESPONSE_FORMAT,
      ...llmTuningParams(config),
    } as any);
    trackLlmCall(costEntry);

    const content = response.choices?.[0]?.message?.content ?? "{}";
    let parsed: { note_text: string; sources: string[] };
    try {
      parsed = JSON.parse(stripJsonFences(content));
    } catch {
      // Some writer models occasionally answer in prose instead of JSON. Re-ask
      // for JSON rather than crashing the whole pipeline; only fail for good
      // once the attempts are exhausted.
      if (attempt >= MAX_WRITER_ATTEMPTS) {
        throw new ModelOutputInvalidError(
          `simpleBot.writer: model output was not valid JSON after ${MAX_WRITER_ATTEMPTS} attempts. content="${content.slice(0, 200)}"`,
        );
      }
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          `Your previous response was not valid JSON. Respond with ONLY a JSON object matching the schema: ` +
          `{ "note_text": string, "sources": string[] }. No prose, no markdown fences.`,
      });
      continue;
    }
    const charCount = countNoteLength(parsed.note_text);

    log?.set(`${logPrefix}.response`, parsed);
    log?.set(`${logPrefix}.charCount`, charCount);

    if (charCount <= MAX_NOTE_CHARS) {
      return { noteText: parsed.note_text, sources: parsed.sources };
    }

    if (attempt >= MAX_WRITER_ATTEMPTS) {
      throw new Error(
        `simple-bot writer exceeded ${MAX_NOTE_CHARS} char limit after ${MAX_WRITER_ATTEMPTS} attempts (last: ${charCount} chars)`,
      );
    }

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content:
        `Your previous note was ${charCount} characters (URLs count as 1 each), but the hard max is ${MAX_NOTE_CHARS}. ` +
        `Rewrite the note shorter while keeping the same correction and sources. Previous note: "${parsed.note_text}"`,
    });
  }

  throw new Error("unreachable");
}
