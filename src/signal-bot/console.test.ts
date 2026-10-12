import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { createConsoleTransport } from "./console";
import type { IncomingMessage } from "./transport";

describe("console transport", () => {
  test("each non-empty line becomes one message, handled in order, on one increasing clock", async () => {
    const output: string[] = [];
    const transport = createConsoleTransport({ input: Readable.from(["https://x.com/a/status/1\n", "\n", "  yes post \n"]), output: text => output.push(text) });
    const handled: IncomingMessage[] = [];
    const sentIds: number[] = [];
    await transport.run(async message => {
      handled.push(message);
      sentIds.push(Number(await transport.send(`reply to ${message.text}`)));
    });
    expect(handled.map(message => message.text)).toEqual(["https://x.com/a/status/1", "yes post"]);
    expect(handled.every(message => message.sender === "console" && message.id === `console:${message.timestamp}`)).toBe(true);
    expect(output).toEqual(["\nreply to https://x.com/a/status/1\n", "\nreply to yes post\n"]);
    // A draft shown by the first reply must sort before the approval that follows it.
    expect(sentIds[0]).toBeGreaterThan(handled[0]!.timestamp);
    expect(handled[1]!.timestamp).toBeGreaterThan(sentIds[0]!);
  });

  test("close ends the loop after the current line", async () => {
    const transport = createConsoleTransport({ input: Readable.from(["one\n", "two\n", "three\n"]), output: () => {} });
    const handled: string[] = [];
    await transport.run(async message => {
      handled.push(message.text);
      if (message.text === "two") transport.close();
    });
    expect(handled).toEqual(["one", "two"]);
  });
});
