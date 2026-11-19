import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addSteps, logRead, readStep } from "./readLog";

// Bun loads the worktree's .env into every test, and on the devbox that file
// holds the production database's address and key. These tests once wrote
// three rows into production that way (2026-11-17). So they remove both, and
// the database write fails. The read log reports that and goes on, so the
// day's file still shows the record.
const FILE_WAIT_MS = 2000;
const DATABASE_VARIABLES = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"] as const;

let dir: string;
const savedDatabaseVariables = new Map<string, string | undefined>();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "read-log-"));
  process.env.PAGE_READ_LOG_DIR = dir;
  process.env.CN_SERVICE = "test";
  for (const name of DATABASE_VARIABLES) {
    savedDatabaseVariables.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  delete process.env.PAGE_READ_LOG_DIR;
  delete process.env.CN_SERVICE;
  for (const [name, value] of savedDatabaseVariables) if (value !== undefined) process.env[name] = value;
  rmSync(dir, { recursive: true, force: true });
});

async function loggedRecords(): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + FILE_WAIT_MS;
  while (Date.now() < deadline) {
    const [file] = readdirSync(dir);
    // A file that does not end in a newline yet is still being written.
    const lines = file ? readFileSync(path.join(dir, file), "utf8") : "";
    if (lines.endsWith("\n")) return lines.trim().split("\n").map((line) => JSON.parse(line));
    await Bun.sleep(20);
  }
  throw new Error("no record was written");
}

describe("logRead", () => {
  test("records the input, every step in order and the outcome, without the text", async () => {
    const answer = await logRead(
      "page",
      "https://example.com/post",
      async () => {
        addSteps([{ step: "ladder: desktop", result: "wall", status: 200, chars: 120, ms: 5 }], Date.now());
        return readStep("Jina Reader", async () => "the page text", (text) => ({ result: "good", chars: text.length }));
      },
      (text) => ({ outcome: "page", via: "jina", chars: text.length, reason: null }),
    );
    expect(answer).toBe("the page text");
    const [record] = await loggedRecords();
    expect(record).toMatchObject({ service: "test", kind: "page", input: "https://example.com/post", outcome: "page", via: "jina", chars: 13 });
    expect(record).not.toHaveProperty("text");
    expect((record!.steps as Array<{ step: string }>).map((step) => step.step)).toEqual(["ladder: desktop", "Jina Reader"]);
  });

  test("records a read that throws and throws on", async () => {
    await expect(
      logRead("listing", "https://x.substack.com", async () => {
        throw new Error("feed refused");
      }, () => ({ outcome: "listing", via: null, chars: null, reason: null })),
    ).rejects.toThrow("feed refused");
    const [record] = await loggedRecords();
    expect(record).toMatchObject({ kind: "listing", outcome: "error", reason: "feed refused" });
  });

  test("records nothing outside the services", async () => {
    delete process.env.PAGE_READ_LOG_DIR;
    await logRead("page", "https://example.com", async () => "text", () => ({ outcome: "page", via: null, chars: 4, reason: null }));
    await Bun.sleep(50);
    expect(readdirSync(dir)).toEqual([]);
  });
});
