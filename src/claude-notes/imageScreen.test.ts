import { describe, expect, test } from "bun:test";
import { imageLinksIn } from "./imageScreen";

describe("imageLinksIn", () => {
  test("finds the image links of a tweet's input", () => {
    const input = "Some tweet\n\n## Images on the post\n\nhttps://pbs.twimg.com/media/GabcDEF?format=jpg&name=large\nhttps://pbs.twimg.com/media/Gxyz.png";
    expect(imageLinksIn(input)).toEqual(["https://pbs.twimg.com/media/GabcDEF?format=jpg&name=large", "https://pbs.twimg.com/media/Gxyz.png"]);
  });

  test("finds images in a post's markdown and ignores ordinary links", () => {
    const post = "See [the paper](https://arxiv.org/abs/2401.1) and ![chart](https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fx.png) or https://example.com/a/photo.JPEG?v=2 here.";
    expect(imageLinksIn(post)).toEqual(["https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fx.png", "https://example.com/a/photo.JPEG?v=2"]);
  });

  test("lists each image once", () => {
    expect(imageLinksIn("https://a.org/x.gif https://a.org/x.gif")).toEqual(["https://a.org/x.gif"]);
  });
});
