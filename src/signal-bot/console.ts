import { createInterface } from "node:readline";
import type { IncomingMessage } from "./transport";

interface ConsoleDependencies {
  input?: NodeJS.ReadableStream;
  output?: (text: string) => void;
  /** Written before each read; omitted when the input is not a terminal. */
  prompt?: string;
}

/** A terminal stand-in for the Signal group: one human, one line per message.
 * The same engine, store, and X submission path run underneath, so a note
 * approved here is submitted exactly as one approved in Signal. */
export function createConsoleTransport(dependencies: ConsoleDependencies = {}) {
  const output = dependencies.output ?? ((text: string) => console.log(text));
  // Draft display and approval ordering compare send ids with message
  // timestamps, so both come from one strictly increasing clock.
  let last = 0;
  const tick = () => (last = Math.max(Date.now(), last + 1));
  let lines: ReturnType<typeof createInterface> | undefined;
  let closed = false;
  return {
    /** Ends run() after the line being handled; later input is ignored. */
    close(): void { closed = true; lines?.close(); },
    async send(text: string): Promise<string> {
      output(`\n${text}\n`);
      return String(tick());
    },
    /** Resolves when the input closes. Each line is handled before the next is read. */
    async run(handle: (message: IncomingMessage) => Promise<void>): Promise<void> {
      const input = dependencies.input ?? process.stdin;
      lines = createInterface({ input, terminal: false });
      const prompt = dependencies.prompt ?? "> ";
      const showPrompt = () => { if (input === process.stdin && process.stdin.isTTY) process.stdout.write(prompt); };
      showPrompt();
      for await (const line of lines) {
        // readline can hand over lines it buffered before close() was called.
        if (closed) break;
        const text = line.trim();
        if (!text) { showPrompt(); continue; }
        const timestamp = tick();
        await handle({ id: `console:${timestamp}`, sender: "console", timestamp, text });
        showPrompt();
      }
    },
  };
}
