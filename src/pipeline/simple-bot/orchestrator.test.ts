import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import * as userMessage from "../prompts/input/userMessage";
import * as verifier from "../verify/sourceVerifier";
import { runSimpleBotPipeline } from "./orchestrator";
import * as search from "./search";
import * as timing from "./timingStage";
import * as writer from "./writer";

const post = { id: "1", author_id: "a", created_at: "2026-09-16", text: "The post", media: [] } as any;
const input = { mediaResult: {}, mediaMadeWithAiLabel: false } as any;

describe("simple bot orchestrator", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  function arrange(
    writerAnswer: { noteText: string; sources: string[] },
    timingVerdict: timing.TimingVerdict = { action: "pass" },
  ) {
    spies.push(spyOn(userMessage, "buildUserMessageFromInput").mockReturnValue("The post"));
    spies.push(spyOn(search, "runSearch").mockResolvedValue({ findings: "The findings", correctionNeeded: true }));
    spies.push(spyOn(timing, "runTimingStage").mockResolvedValue(timingVerdict));
    spies.push(spyOn(writer, "runWriter").mockResolvedValue(writerAnswer));
    const verify = spyOn(verifier, "verifySources").mockResolvedValue({
      accepted: true, reasoning: "", good_sources: writerAnswer.sources, bad_sources: [],
    } as any);
    spies.push(verify);
    return verify;
  }

  test("an empty note from the writer is a no-correction outcome and skips the verifier", async () => {
    const verify = arrange({ noteText: "", sources: [] });
    const outcome = await withBotConfig(DEFAULT_CONFIG, () => runSimpleBotPipeline(post, input));
    expect(outcome.type).toBe("no_correction");
    expect(verify).not.toHaveBeenCalled();
  });

  test("a whitespace-only note counts as empty too", async () => {
    const verify = arrange({ noteText: " \n", sources: [] });
    const outcome = await withBotConfig(DEFAULT_CONFIG, () => runSimpleBotPipeline(post, input));
    expect(outcome.type).toBe("no_correction");
    expect(verify).not.toHaveBeenCalled();
  });

  test("a written note still goes through the verifier", async () => {
    const verify = arrange({ noteText: "The crash was in Zaire, not Siberia.", sources: ["https://example.com"] });
    const outcome = await withBotConfig(DEFAULT_CONFIG, () => runSimpleBotPipeline(post, input));
    expect(outcome.type).toBe("note");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  test("the timing stage always runs and its block reaches the writer", async () => {
    arrange({ noteText: "", sources: [] }, { action: "inform", contextBlock: "\nTiming context" });
    await withBotConfig(DEFAULT_CONFIG, () => runSimpleBotPipeline(post, input));
    expect(writer.runWriter).toHaveBeenCalledWith("The post", "The findings", { timingContext: "\nTiming context" });
  });
});
