import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_CONFIG, withBotConfig } from "../ab-testing/botConfig";
import * as userMessage from "../prompts/input/userMessage";
import * as verifier from "../verify/sourceVerifier";
import { runSimpleBotPipeline } from "./orchestrator";
import * as search from "./search";
import * as secondRound from "./secondRound";
import { UnfetchableSourcesError } from "../utils/errors";
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

  describe("the second research round", () => {
    const rejected = { accepted: false, reasoning: "The Texas claim has no source.", good_sources: [], bad_sources: ["https://a.example"] } as any;
    const accepted = { accepted: true, reasoning: "", good_sources: ["https://b.example"], bad_sources: [] } as any;
    const secondRoundConfig = { ...DEFAULT_CONFIG, second_round: true };

    function arrangeSecondRound(verdicts: unknown[], revision = { findings: "Revised findings", withdrew: false }) {
      spies.push(spyOn(userMessage, "buildUserMessageFromInput").mockReturnValue("The post"));
      spies.push(spyOn(search, "runSearch").mockResolvedValue({ findings: "The findings", correctionNeeded: true }));
      spies.push(spyOn(timing, "runTimingStage").mockResolvedValue({ action: "pass" }));
      const write = spyOn(writer, "runWriter").mockResolvedValueOnce({ noteText: "First note", sources: ["https://a.example"] }).mockResolvedValueOnce({ noteText: "Second note", sources: ["https://b.example"] });
      const verify = spyOn(verifier, "verifySources");
      for (const verdict of verdicts) {
        if (verdict instanceof Error) verify.mockRejectedValueOnce(verdict);
        else verify.mockResolvedValueOnce(verdict as any);
      }
      const revise = spyOn(secondRound, "reviseResearch").mockResolvedValue(revision);
      spies.push(write, verify, revise);
      return { write, verify, revise };
    }

    test("a rejected note gets a second round, and the revised note that the verifier accepts is the result", async () => {
      const { write, verify, revise } = arrangeSecondRound([rejected, accepted]);
      const outcome = await withBotConfig(secondRoundConfig, () => runSimpleBotPipeline(post, input));
      expect(outcome.type).toBe("note");
      expect(revise).toHaveBeenCalledTimes(1);
      expect(revise.mock.calls[0]![0]).toMatchObject({ findings: "The findings", noteText: "First note", researchedBy: "full", verification: rejected });
      expect(write.mock.calls[1]).toEqual(["The post", "Revised findings", { timingContext: undefined }]);
      expect(verify.mock.calls.map((call) => call[0].turnNumber)).toEqual([1, 2]);
    });

    test("without the arm a rejected note stays rejected and nothing is revised", async () => {
      const { revise } = arrangeSecondRound([rejected]);
      const outcome = await withBotConfig(DEFAULT_CONFIG, () => runSimpleBotPipeline(post, input));
      expect(outcome.type).toBe("verification_failed");
      expect(revise).not.toHaveBeenCalled();
    });

    test("an accepted first note needs no second round", async () => {
      const { revise } = arrangeSecondRound([accepted]);
      const outcome = await withBotConfig(secondRoundConfig, () => runSimpleBotPipeline(post, input));
      expect(outcome.type).toBe("note");
      expect(revise).not.toHaveBeenCalled();
    });

    test("a second round that is rejected again ends as rejected, with the second note", async () => {
      arrangeSecondRound([rejected, rejected]);
      const outcome: any = await withBotConfig(secondRoundConfig, () => runSimpleBotPipeline(post, input));
      expect(outcome.type).toBe("verification_failed");
      expect(outcome.noteText).toBe("Second note");
    });

    test("research that now says no note is needed ends the check as no correction", async () => {
      const { write } = arrangeSecondRound([rejected], { findings: "On reflection the claim is fine.", withdrew: true });
      const outcome: any = await withBotConfig(secondRoundConfig, () => runSimpleBotPipeline(post, input));
      expect(outcome).toMatchObject({ type: "no_correction", reason: "On reflection the claim is fine." });
      expect(write).toHaveBeenCalledTimes(1);
    });

    test("when no revised source can be opened, the first rejection stands", async () => {
      arrangeSecondRound([rejected, new UnfetchableSourcesError("None of the 1 non-Twitter source(s) could be fetched")]);
      const outcome: any = await withBotConfig(secondRoundConfig, () => runSimpleBotPipeline(post, input));
      expect(outcome.type).toBe("verification_failed");
      expect(outcome.noteText).toBe("First note");
    });
  });
});
