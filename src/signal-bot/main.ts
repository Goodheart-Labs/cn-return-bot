import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDraftingAdapter } from "./drafting";
import { SignalBot } from "./engine";
import { SignalStore } from "./store";
import { createConsoleTransport } from "./console";
import { NotesFeed } from "./feed";
import { RunSummaries } from "./runSummary";
import { startOperatorEndpoint } from "./operator";
import { SignalTransport, loadSignalTransportConfig, sameGroup } from "./transport";

const HELP = `Signal Community Notes bot

Usage: bun src/signal-bot/main.ts [--dry-run] [--console]

Paste a tweet in the configured group for an access check and proposed note.
Reply to a draft (or prefix a message with #conversation-number) to discuss it.
‘yes post’ submits or queues the exact current version; ‘yes’ also works when replying
directly to the current draft. ‘draft’ shows it again; ‘cancel’ withdraws it.
Other messages get a plain-language answer about the bot and its conversations,
unless SIGNAL_ADDRESSED_ONLY=true, when the bot stays silent except for tweet links,
#numbers, quotes of or @-mentions of its account, and messages starting with “bot”.
SIGNAL_TRIGGER=mention is stricter: only an @-mention of the bot counts.
Every reply starts with “Bot”, since the bot may post from the owner's own account.

--dry-run   Research and reply, but never submit to X.
--console   Chat from this terminal instead of Signal: one line per message,
            same engine and submission path, separate state file. Use #n to
            pick a conversation; ‘yes post’ submits when one is open.
--help      Show this help without connecting to any service.

Required: X_API_KEY, X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET,
OPENROUTER_API_KEY, and (without --console) SIGNAL_API_URL, SIGNAL_NUMBER, SIGNAL_GROUP_ID.
Optional X_READ_* credentials read tweets when the writer app cannot.
Search uses Anthropic native web search through OpenRouter.
Live submission also needs SUPABASE_URL and SUPABASE_SERVICE_KEY,
and migration 100 applied before both this worker and the scheduled pipeline.

SIGNAL_LISTEN_GROUP_IDS (comma-separated) surfaces other groups' messages in the log
for the operator without answering them.
State: SIGNAL_STATE_PATH (default output/signal-bot[-console][-dry-run].sqlite).
Notes feed: SIGNAL_NOTES_FEED_GROUP_ID posts every note any pipeline submits to X
(from the notes table, needs SUPABASE_URL) into that group, checking every minute.
SIGNAL_RUN_SUMMARIES=true also posts one line-group per scheduled pipeline run there
(tweets processed, where each stopped, notes posted, writing-limit state);
SIGNAL_RUN_SUMMARY_LOOKBACK_MIN covers earlier runs on first start.
Local operation: SIGNAL_OPERATOR_PORT=18081 opens a loopback endpoint (see operator.ts)
that posts a line labelled SIGNAL_OPERATOR_LABEL (default "Claude") to the group and
feeds it to the bot; SIGNAL_LOG_CONTENT=true
logs message and reply text (never on the shared server).
Existing personal account: SIGNAL_ACCEPT_SELF_MESSAGES=true handles your phone's
messages while ignoring the bot's own replies.
Setup and recovery: scripts/signal-bot/README.md
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--console")) throw new Error("Unknown option. Use --help for usage.");
  const dryRun = args.includes("--dry-run");
  const consoleMode = args.includes("--console");
  const config = consoleMode ? undefined : loadSignalTransportConfig();
  const required = ["X_API_KEY", "X_API_KEY_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "OPENROUTER_API_KEY"];
  if (!dryRun) required.push("SUPABASE_URL", "SUPABASE_SERVICE_KEY");
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);

  // SQLite contains private group discussion and approval records.
  process.umask(0o077);
  const statePath = resolve(process.env.SIGNAL_STATE_PATH?.trim() || `output/signal-bot${consoleMode ? "-console" : ""}${dryRun ? "-dry-run" : ""}.sqlite`);
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const scope = JSON.stringify([config?.number ?? "console", config?.groupId ?? "", process.env.SUPABASE_URL ?? "", dryRun]);
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
    const log = (line: string) => console.log(`[signal] ${new Date().toISOString()} ${line}`);
    const terminal = consoleMode ? createConsoleTransport() : undefined;
    if (config) transport = new SignalTransport(config, { onError });
    const logContent = process.env.SIGNAL_LOG_CONTENT?.trim().toLowerCase() === "true";
    const sentTexts: string[] = [];
    const send = async (text: string, quote?: Parameters<SignalTransport["send"]>[1]): Promise<string> => {
      sentTexts.push(text);
      if (logContent) console.log(`[signal] → ${text}`);
      // Operator-injected messages never existed in Signal, so there is nothing to quote.
      // A reply to a listen-only group's message goes back to that group.
      return terminal ? terminal.send(text) : transport!.send(text, quote?.sender === "operator" ? undefined : quote, quote?.fromGroup);
    };
    const notesForChat = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? async () => {
      const { SupabaseLogger } = await import("../api/supabaseClient");
      const rows = await new SupabaseLogger().listNotesSubmittedSince(new Date(Date.now() - 24 * 3600_000).toISOString(), 40);
      return rows.map((row) => ({ postedAt: row.submitted_at, tweet: `https://x.com/i/status/${row.tweet_id}`, note: row.note_text.slice(0, 300), link: `https://x.com/i/communitynotes/${row.note_id}` }));
    } : undefined;
    const bot = new SignalBot({
      store,
      drafting: createDraftingAdapter(),
      send,
      pipelineNotes: notesForChat,
      submit,
      cancelSubmission,
      registerSubmission,
      dryRun,
      addressedOnly: process.env.SIGNAL_ADDRESSED_ONLY?.trim().toLowerCase() === "true",
      mentionOnly: process.env.SIGNAL_TRIGGER?.trim().toLowerCase() === "mention",
      onError,
      log: terminal ? undefined : log,
    });
    const feedGroupId = process.env.SIGNAL_NOTES_FEED_GROUP_ID?.trim();
    const groupLabel = (id: string) => (feedGroupId && sameGroup(id, feedGroupId) ? "live" : id.slice(0, 14));
    const operatorLabel = process.env.SIGNAL_OPERATOR_LABEL?.trim() || "Claude";
    const operatorSends = new Set<string>();
    const handle = (incoming: Parameters<SignalBot["handle"]>[0]) => {
      // Listen-only groups are always surfaced for the operator; the engine only
      // answers there when addressed, and never drafts or approves there.
      if (incoming.fromGroup) console.log(`[signal] ← [${groupLabel(incoming.fromGroup)}] ${incoming.sender.slice(0, 8)}: ${incoming.text}`);
      else if (logContent) console.log(`[signal] ← ${incoming.sender.slice(0, 8)}: ${incoming.text}`);
      // A reply to the operator's own line is a conversation with the operator,
      // not with the bot, even though both are sent from the bot's account.
      const message = incoming.quotesBot && ((incoming.quoteId && operatorSends.has(incoming.quoteId)) || incoming.quoteText?.startsWith(`${operatorLabel}:`))
        ? { ...incoming, quotesBot: false }
        : incoming;
      return bot.handle(message);
    };
    const operatorPort = Number(process.env.SIGNAL_OPERATOR_PORT?.trim() || 0);
    const operator = operatorPort && transport ? startOperatorEndpoint({
      port: operatorPort,
      // Recorded as bot output so a synced echo of the announcement is ignored.
      announce: async (text, group) => {
        store.recordBotOutput(text);
        let id: string;
        if (!group) id = await send(text);
        else {
          sentTexts.push(`[${group}] ${text}`);
          if (logContent) console.log(`[signal] → [${group}] ${text}`);
          id = await transport!.send(text, undefined, group === "live" && feedGroupId ? feedGroupId : group);
        }
        operatorSends.add(id);
        return id;
      },
      handle,
      sent: () => sentTexts,
      label: process.env.SIGNAL_OPERATOR_LABEL?.trim() || undefined,
    }) : undefined;
    let feedTimer: ReturnType<typeof setInterval> | undefined;
    if (feedGroupId && config && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const { SupabaseLogger } = await import("../api/supabaseClient");
      const feedLogger = new SupabaseLogger();
      // A send-only transport for the feed group; it is never connected for receiving.
      const feedTransport = new SignalTransport({ ...config, groupId: feedGroupId }, { onError });
      const feed = new NotesFeed({
        store,
        listNotesSince: (since, limit) => feedLogger.listNotesSubmittedSince(since, limit),
        send: (text) => feedTransport.send(text),
        onError,
      });
      const summaries = process.env.SIGNAL_RUN_SUMMARIES?.trim().toLowerCase() === "true" ? new RunSummaries({
        store,
        listRunsSince: (since, limit) => feedLogger.listPipelineRunsSince(since, limit),
        capacity: () => feedLogger.getNoteSubmissionCapacity(),
        send: (text) => feedTransport.send(text),
        onError,
        lookbackMs: Number(process.env.SIGNAL_RUN_SUMMARY_LOOKBACK_MIN?.trim() || 0) * 60_000,
      }) : undefined;
      const pollFeed = async () => {
        const posted = await feed.poll();
        if (posted) log(`notes feed posted ${posted} note${posted === 1 ? "" : "s"}`);
        const runs = await summaries?.poll();
        if (runs) log(`posted ${runs} run summar${runs === 1 ? "y" : "ies"}`);
      };
      feedTimer = setInterval(() => { void pollFeed(); }, 60_000);
      void pollFeed();
    }
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(retryTimer);
      clearInterval(feedTimer);
      operator?.stop();
      console.log("[signal] Finishing accepted messages before shutdown…");
      try {
        if (transport) await transport.close(bot.drain());
        else { terminal?.close(); await bot.drain(); }
      }
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
    transport?.connect(handle);
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
    const reader = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"].some((suffix) => process.env[`X_READ_${suffix}`]);
    console.log(`[signal] Tweet lookup uses the ${reader ? "X_READ_* reader" : "writer app's"} credentials.`);
    if (terminal) {
      console.log(`[signal] Console mode${dryRun ? " (dry run: X submissions disabled)" : ""}. Paste a tweet link, or type a message. Ctrl-D to quit.`);
      await terminal.run(handle);
      await stop();
      return;
    }
    if (operator) console.log(`[signal] Operator endpoint on 127.0.0.1:${operator.port}.`);
    if (feedTimer) console.log("[signal] Notes feed enabled: new submitted notes are posted to the feed group.");
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
