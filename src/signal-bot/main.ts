import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDraftingAdapter } from "./drafting";
import { SignalBot } from "./engine";
import { SignalStore } from "./store";
import { SignalTransport, loadSignalTransportConfig } from "./transport";

const HELP = `Signal Community Notes bot

Usage: bun src/signal-bot/main.ts [--dry-run]

Paste a tweet in the configured group for an access check and proposed note.
Reply to a draft (or prefix a message with #conversation-number) to discuss it.
‘yes post’ submits or queues the exact current version; ‘yes’ also works when replying
directly to the current draft. ‘draft’ shows it again; ‘cancel’ withdraws it.

--dry-run   Research and reply in Signal, but never submit to X.
--help      Show this help without connecting to any service.

Required: SIGNAL_API_URL, SIGNAL_NUMBER, SIGNAL_GROUP_ID, X_API_KEY,
X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, OPENROUTER_API_KEY.
Search uses Anthropic native web search through OpenRouter.
Live submission also needs SUPABASE_URL and SUPABASE_SERVICE_KEY,
and migration 100 applied before both this worker and the scheduled pipeline.

State: SIGNAL_STATE_PATH (default output/signal-bot[-dry-run].sqlite).
Existing personal account: SIGNAL_ACCEPT_SELF_MESSAGES=true handles your phone's
messages while ignoring the bot's own replies.
Setup and recovery: docs/signal-bot.md
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("Unknown option. Use --help for usage.");
  const dryRun = args.includes("--dry-run");
  const config = loadSignalTransportConfig();
  const required = ["X_API_KEY", "X_API_KEY_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "OPENROUTER_API_KEY"];
  if (!dryRun) required.push("SUPABASE_URL", "SUPABASE_SERVICE_KEY");
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);

  // SQLite contains private group discussion and approval records.
  process.umask(0o077);
  const statePath = resolve(process.env.SIGNAL_STATE_PATH?.trim() || `output/signal-bot${dryRun ? "-dry-run" : ""}.sqlite`);
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const scope = JSON.stringify([config.number, config.groupId, process.env.SUPABASE_URL ?? "", dryRun]);
  const store = new SignalStore(statePath, scope);
  let transport: SignalTransport | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  try {
    store.acquireWorker();
    let submit: ConstructorParameters<typeof SignalBot>[0]["submit"] = async () => {
      throw new Error("Dry-run submission must never be called.");
    };
    let cancelSubmission: ConstructorParameters<typeof SignalBot>[0]["cancelSubmission"];
    let registerSubmission: ConstructorParameters<typeof SignalBot>[0]["registerSubmission"];
    if (!dryRun) {
      const { SupabaseLogger } = await import("../api/supabaseClient");
      const { createSignalSubmitter, createSignalRegistrar } = await import("./submission");
      const logger = new SupabaseLogger();
      // A missing migration or unreadable quota must stop startup before the
      // worker receives approvals it cannot safely carry out.
      await logger.getNoteSubmissionCapacity();
      submit = createSignalSubmitter(logger);
      registerSubmission = createSignalRegistrar(logger);
      cancelSubmission = (conversation) => logger.cancelSignalSubmission(conversation.tweetId);
    }
    const onError = (error: unknown) => console.error("[signal]", error instanceof Error ? error.message : "Operation failed");
    transport = new SignalTransport(config, { onError });
    const bot = new SignalBot({
      store,
      drafting: createDraftingAdapter(),
      send: (text, quote) => transport!.send(text, quote),
      submit,
      cancelSubmission,
      registerSubmission,
      dryRun,
      onError,
    });
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(retryTimer);
      console.log("[signal] Finishing accepted messages before shutdown…");
      try { await transport!.close(bot.drain()); }
      finally {
        const { closeBrowser } = await import("../pipeline/utils/browserManager");
        try { await closeBrowser(); }
        finally { store.close(); }
      }
    };
    process.once("SIGINT", () => { void stop(); });
    process.once("SIGTERM", () => { void stop(); });
    // Queue durable pending messages first, but keep receiving while their
    // research runs. Processing messages from a crash are deliberately skipped.
    void bot.resumePending().catch(onError);
    transport.connect((message) => bot.handle(message));
    if (!dryRun) {
      let retrying = false;
      const retry = async () => {
        if (stopping || retrying) return;
        retrying = true;
        try { await bot.retryQueued(); }
        catch (error) { onError(error); }
        finally { retrying = false; }
      };
      retryTimer = setInterval(() => { void retry(); }, 30_000);
    }
    console.log(`[signal] Listening to the configured group${dryRun ? " (dry run: X submissions disabled)" : ""}.`);
  } catch (error) {
    clearInterval(retryTimer);
    await transport?.close();
    store.close();
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[signal]", error instanceof Error ? error.message : "Startup failed");
    process.exitCode = 1;
  });
}
