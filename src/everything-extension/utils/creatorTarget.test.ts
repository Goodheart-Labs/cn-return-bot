import { describe, expect, test } from "bun:test";
import { forumAuthorFromPageLink, forumAuthorTarget, forumOrigin } from "./creatorTarget";

describe("the EA Forum", () => {
  test("is a forum, at its own origin without www", () => {
    expect(forumOrigin("https://forum.effectivealtruism.org/posts/abc/title")).toBe("https://forum.effectivealtruism.org");
    expect(forumOrigin("https://effectivealtruism.org/posts/abc")).toBeNull();
  });

  test("an author page is a creator in the form migration 179 accepts", () => {
    expect(forumAuthorTarget("https://forum.effectivealtruism.org/users/Toby-Tremlett", "Toby Tremlett")).toEqual({
      feedType: "lesswrong",
      feedUrl: "https://forum.effectivealtruism.org/users/toby-tremlett",
      kind: "author",
      title: "Toby Tremlett",
    });
  });

  test("the author link read out of a post page becomes the same creator", () => {
    expect(forumAuthorFromPageLink({ href: "https://forum.effectivealtruism.org/users/toby-tremlett", name: "Toby Tremlett" })?.feedUrl).toBe(
      "https://forum.effectivealtruism.org/users/toby-tremlett",
    );
    expect(forumAuthorFromPageLink(null)).toBeNull();
  });
});
