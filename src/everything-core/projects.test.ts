import { describe, expect, test } from "bun:test";
import { creatorPlatform } from "./projects";

describe("creatorPlatform", () => {
  test("names the platform of each canonical feed URL", () => {
    expect(creatorPlatform("https://thezvi.substack.com")).toBe("Substack");
    expect(creatorPlatform("https://www.youtube.com/@DwarkeshPatel")).toBe("YouTube");
    expect(creatorPlatform("https://www.lesswrong.com/users/zvi")).toBe("LessWrong");
    expect(creatorPlatform("https://www.alignmentforum.org/users/paulfchristiano")).toBe("Alignment Forum");
  });

  test("gives null for anything else", () => {
    expect(creatorPlatform("https://ai-2040.com")).toBeNull();
    expect(creatorPlatform("not a url")).toBeNull();
  });
});
