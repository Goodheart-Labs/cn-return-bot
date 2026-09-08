import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import { withMonitoringContext } from "../misinfo-monitoring/monitoringContext";
import {
  MISINFO_CONCEDE_SHAPE_RULE,
  MISINFO_NOTE_SHAPE_RULE,
  MISINFO_SOURCING_RULE,
  WRITER_CENTRAL_CLAIM_RULE,
  WRITER_DEFAULT_RULE,
  WRITER_LAST_CHECK,
  WRITER_SYSTEM_PROMPT,
  WRITER_TIME_TRAVEL_RULE,
} from "../prompts/simple-bot/writer";
import * as llm from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog } from "../utils/tweetLog";
import { runWriter } from "./writer";

describe("writer prompt assembly", () => {
  let call: ReturnType<typeof spyOn<typeof llm, "runJsonLlmCall">>;

  afterEach(() => call?.mockRestore());

  for (const enabled of [true, false, undefined]) {
    test(`writer_central_claim ${String(enabled)} selects the rule and logs the treatment`, async () => {
      call = spyOn(llm, "runJsonLlmCall").mockResolvedValue({ note_text: "", sources: [] });
      const log = createTweetLog();
      await withBotConfig({ ...DEFAULT_CONFIG, writer_central_claim: enabled }, () =>
        withTweetLog(log, () => runWriter("The post", "The findings")));
      const systemPrompt = call.mock.calls[0]![0].messages[0]!.content as string;
      if (enabled) {
        expect(systemPrompt).toContain(WRITER_CENTRAL_CLAIM_RULE);
        expect(systemPrompt).not.toContain("Your note must DISPUTE something the tweet asserts");
        expect(log.get("writer.centralClaim")).toBe(true);
      } else {
        expect(systemPrompt).toBe(WRITER_SYSTEM_PROMPT);
        expect(systemPrompt).toContain(WRITER_DEFAULT_RULE);
        expect(createHash("sha256").update(systemPrompt).digest("hex"))
          .toBe("272828738e3d977d6234e4982982d5ee417787999838d71033058069b87799a9");
        expect(log.get("writer.centralClaim")).toBeUndefined();
      }
    });
  }

  test("central-claim wording preserves timing, last-check and curated-topic assembly", async () => {
    call = spyOn(llm, "runJsonLlmCall").mockResolvedValue({ note_text: "", sources: [] });
    await withBotConfig({
      ...DEFAULT_CONFIG,
      writer_central_claim: true,
      writer_last_check: true,
      time_travel_prompt: true,
      concede_shape: true,
    }, () => withMonitoringContext({
      topicId: "trump_election_security", topicTitle: "A curated topic", document: "Reference findings",
    }, () => runWriter("The post", "The findings", { timingContext: "\nTiming context" })));
    const messages = call.mock.calls[0]![0].messages;
    expect(messages[0]!.content).toBe(
      WRITER_SYSTEM_PROMPT.replace(WRITER_DEFAULT_RULE, WRITER_CENTRAL_CLAIM_RULE)
      + WRITER_TIME_TRAVEL_RULE + WRITER_LAST_CHECK
      + MISINFO_SOURCING_RULE + MISINFO_NOTE_SHAPE_RULE + MISINFO_CONCEDE_SHAPE_RULE,
    );
    expect(messages[1]!.content).toBe(
      'The post\n\n## Research findings\n\n## Reference document (ground truth on "A curated topic")\n'
      + "Reference findings\n\nThe findings\nTiming context",
    );
  });
});
