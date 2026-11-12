import { describe, expect, test } from "bun:test";
import { classifyMarkdown } from "./fetchLadder";

describe("classifyMarkdown", () => {
  test("archive.ph's CAPTCHA page is a wall, not the article", () => {
    // What the services box got for an EA Forum post on 2026-11-12.
    const captchaPage = `[fetched via archive.ph snapshot]

# archive.ph

## One more step

## Please complete the security check to access

## Why do I have to complete a CAPTCHA?

Completing the CAPTCHA proves you are a human and gives you temporary access to the web property.

## What can I do to prevent this in the future?

If you are on a personal connection, like at home, you can run an anti-virus scan on your device to make sure it is not infected with malware.`.padEnd(700, " ");
    expect(classifyMarkdown(captchaPage)).toBe("wall");
  });
});
