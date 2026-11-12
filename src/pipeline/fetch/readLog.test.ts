import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addSteps, logRead, readStep } from "./readLog";

// The database write fails here, because a test has no Supabase address. The
// read log reports that and goes on, so the day's file still shows the record.
const FILE_WAIT_MS = 2000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "read-log-"));
  process.env.PAGE_READ_LOG_DIR = dir;
  process.env.CN_SERVICE = "test";
});

afterEach(() => {
  delete process.env.PAGE_READ_LOG_DIR;
  delete process.env.CN_SERVICE;
  rmSync(dir, { recursive: true, force: true });
});

async function loggedRecords(): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + FILE_WAIT_MS;
  while (Date.now() < deadline) {
    const [file] = readdirSync(dir);
    if (file) return readFileSync(path.join(dir, file), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    await Bun.sleep(20);
  }
  throw new Error("no record was written");
}

describe("logRead", () => {
  test("records the input, every step in order, the outcome and the text", async () => {
    const answer = await logRead(
      "page",
      "https://example.com/post",
      async () => {
        addSteps([{ step: "ladder: desktop", result: "wall", status: 200, chars: 120, ms: 5 }], Date.now());
        return readStep("Jina Reader", async () => "the page text", (text) => ({ result: "good", chars: text.length }));
      },
      (text) => ({ outcome: "page", via: "jina", chars: text.length, reason: null, text }),
    );
    expect(answer).toBe("the page text");
    const [record] = await loggedRecords();
    expect(record).toMatchObject({ service: "test", kind: "page", input: "https://example.com/post", outcome: "page", via: "jina", chars: 13, text: "the page text" });
    expect((record!.steps as Array<{ step: string }>).map((step) => step.step)).toEqual(["ladder: desktop", "Jina Reader"]);
  });

  test("records a read that throws and throws on", async () => {
    await expect(
      logRead("listing", "https://x.substack.com", async () => {
        throw new Error("feed refused");
      }, () => ({ outcome: "listing", via: null, chars: null, reason: null, text: null })),
    ).rejects.toThrow("feed refused");
    const [record] = await loggedRecords();
    expect(record).toMatchObject({ kind: "listing", outcome: "error", reason: "feed refused" });
  });

  test("records nothing outside the services", async () => {
    delete process.env.PAGE_READ_LOG_DIR;
    await logRead("page", "https://example.com", async () => "text", () => ({ outcome: "page", via: null, chars: 4, reason: null, text: "text" }));
    await Bun.sleep(50);
    expect(readdirSync(dir)).toEqual([]);
  });
});
