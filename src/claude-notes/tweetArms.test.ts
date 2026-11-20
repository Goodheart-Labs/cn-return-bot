import { describe, expect, test } from "bun:test";
import { CLAUDE_X_TESTS } from "../pipeline/ab-testing/abTestsData";
import { tweetPrompt } from "./prompts";
import { CLAUDE_X_MODEL_ARMS, tweetHasExamples, tweetModel, WITHOUT_EXAMPLES } from "./tweetArms";

const variantsOf = (name: string) => CLAUDE_X_TESTS.find((t) => t.name === name)!.variants.map((v) => v.variant.name);

describe("the Claude tweet arms", () => {
  test("every model variant the X run can draw has a command", () => {
    expect(variantsOf("claude_x_model").sort()).toEqual(Object.keys(CLAUDE_X_MODEL_ARMS).sort());
  });
  test("the examples test has the variant the runner reads", () => {
    expect(variantsOf("claude_x_examples")).toContain(WITHOUT_EXAMPLES);
  });
  test("a tweet drawn before the tests keeps Opus at high effort with the examples", () => {
    expect(tweetModel({})).toEqual({ model: "opus", effort: "high" });
    expect(tweetHasExamples({})).toBe(true);
  });
  test("the prompt mentions the examples only when the system prompt has them", () => {
    const tweet = (picks: Record<string, string>) => ({ runId: "run-1", input: "A tweet", picks }) as any;
    expect(tweetPrompt({ tweet: tweet({}), runDir: "/r" })).toContain("examples");
    expect(tweetPrompt({ tweet: tweet({ claude_x_examples: WITHOUT_EXAMPLES }), runDir: "/r" })).not.toContain("examples");
  });
});
