import { expect, test } from "bun:test";
import { pictureFileName } from "./typefully";

// The pattern Typefully's media upload answered with in its 422 on 2026-11-10.
const TYPEFULLY_FILE_NAME = /^[a-zA-Z0-9_.()\-]+\.([jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[wW][eE][bB][pP]|[gG][iI][fF]|[mM][pP]4|[mM][oO][vV]|[pP][dD][fF])$/;

test("the picture's file name passes Typefully's check", () => {
  const name = pictureFileName("Common Note 9729f1d5-e628-46d9-ba4a-ff9800f84953");
  expect(name).toBe("Common-Note-9729f1d5-e628-46d9-ba4a-ff9800f84953.png");
  expect(name).toMatch(TYPEFULLY_FILE_NAME);
  expect("Common Note 9729f1d5.png").not.toMatch(TYPEFULLY_FILE_NAME);
});
