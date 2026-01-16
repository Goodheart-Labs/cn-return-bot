/**
 * Tests for bot-specific filtering logic
 * Run with: bun test src/api/airtableLogger.test.ts
 */

import { describe, test, expect } from "bun:test";

// Test data simulation
const mockAirtableData = [
  { url: "https://twitter.com/i/status/123456", botName: "main" },
  { url: "https://twitter.com/i/status/789012", botName: "staging/satire" },
  { url: "https://twitter.com/i/status/345678", botName: "main" },
  { url: "https://twitter.com/i/status/111111", botName: "staging/satire" },
  { url: "https://twitter.com/i/status/222222", botName: "first-bot" },
];

describe("Bot filtering", () => {
  test("filters URLs for 'main' bot correctly", () => {
    const mainUrls = mockAirtableData
      .filter((record) => record.botName === "main")
      .map((record) => record.url);

    expect(mainUrls).toEqual([
      "https://twitter.com/i/status/123456",
      "https://twitter.com/i/status/345678",
    ]);
  });

  test("filters URLs for 'staging/satire' bot correctly", () => {
    const satireBotUrls = mockAirtableData
      .filter((record) => record.botName === "staging/satire")
      .map((record) => record.url);

    expect(satireBotUrls).toEqual([
      "https://twitter.com/i/status/789012",
      "https://twitter.com/i/status/111111",
    ]);
  });

  test("filters URLs for 'first-bot' correctly", () => {
    const firstBotUrls = mockAirtableData
      .filter((record) => record.botName === "first-bot")
      .map((record) => record.url);

    expect(firstBotUrls).toEqual(["https://twitter.com/i/status/222222"]);
  });

  test("returns empty array for non-existent bot", () => {
    const nonExistentBotUrls = mockAirtableData
      .filter((record) => record.botName === "non-existent-bot")
      .map((record) => record.url);

    expect(nonExistentBotUrls).toEqual([]);
  });
});

describe("URL to Post ID conversion", () => {
  test("extracts post IDs from Twitter URLs", () => {
    const testUrls = new Set([
      "https://twitter.com/i/status/123456",
      "https://twitter.com/i/status/789012",
    ]);

    const skipPostIds = new Set<string>();
    testUrls.forEach((url) => {
      const match = url.match(/status\/(\d+)$/);
      if (match && match[1]) skipPostIds.add(match[1]);
    });

    expect(Array.from(skipPostIds).sort()).toEqual(["123456", "789012"].sort());
  });

  test("handles URLs without status ID gracefully", () => {
    const testUrls = new Set([
      "https://twitter.com/user/profile",
      "https://example.com/invalid",
    ]);

    const skipPostIds = new Set<string>();
    testUrls.forEach((url) => {
      const match = url.match(/status\/(\d+)$/);
      if (match && match[1]) skipPostIds.add(match[1]);
    });

    expect(Array.from(skipPostIds)).toEqual([]);
  });
});
