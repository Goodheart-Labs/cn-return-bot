import { expect, mock, test } from "bun:test";

// The module's data functions need the Supabase client; the two parsers do not.
void mock.module("./supabase", () => ({ supabase: {} }));
const { evidenceLink, noteIdFromLink } = await import("./corrections");

const ID = "56a2611a-6736-43d6-a4d0-0cb95bb0f379";

test("a link to one note names its note, with or without tracking parameters", () => {
  expect(noteIdFromLink(`https://commonnotes.net/notes/benthams?note=${ID}`)).toBe(ID);
  expect(noteIdFromLink(` https://commonnotes.net/notes/benthams?note=${ID}&utm_source=x&utm_content=${ID} `)).toBe(ID);
  expect(noteIdFromLink(ID.toUpperCase())).toBe(ID);
});

test("text that names no note gives null", () => {
  expect(noteIdFromLink("https://commonnotes.net/notes/benthams")).toBeNull();
  expect(noteIdFromLink(`https://commonnotes.net/notes/benthams?note=${ID}x`)).toBeNull();
  expect(noteIdFromLink("")).toBeNull();
});

test("only an https address is evidence", () => {
  expect(evidenceLink(" https://x.com/Benthamsbulldog/status/2123483442868584857 ")).toBe("https://x.com/Benthamsbulldog/status/2123483442868584857");
  expect(evidenceLink("http://x.com/a")).toBeNull();
  expect(evidenceLink("javascript:alert(1)")).toBeNull();
  expect(evidenceLink("fixed, thanks")).toBeNull();
});
