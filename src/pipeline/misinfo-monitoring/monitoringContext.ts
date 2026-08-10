/**
 * Per-post monitoring context for the XXL-feed misinfo pre-pass.
 *
 * This follows the same AsyncLocalStorage pattern as withBotConfig and withTweetLog.
 * It is kept apart from BotConfig because the reference document belongs to a single
 * post's run. It records which misinfo topic that post matched, and it is not an A/B
 * variant.
 *
 * A regular small-feed post runs with no monitoring context at all.
 * getMonitoringContext then returns undefined and no document is injected.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { MisinfoTopicId } from "./topicIds";
import { getBotConfig } from "../ab-testing/botConfig";

export interface MonitoringContext {
  topicId: MisinfoTopicId;
  topicTitle: string;
  /** The reference article's canonical source URL. It leads the injected block, so
   *  the bot can cite it directly in the note. A hand-authored document that carries
   *  its own sources for each claim has no such URL. */
  documentUrl?: string;
  /** The whole article, with nothing summarised away. It is injected into the bot's
   *  research step. */
  document: string;
}

const storage = new AsyncLocalStorage<MonitoringContext>();

export function withMonitoringContext<T>(ctx: MonitoringContext | undefined, fn: () => T): T {
  return ctx ? storage.run(ctx, fn) : fn();
}

export function getMonitoringContext(): MonitoringContext | undefined {
  return storage.getStore();
}

/** A topic document wraps content that belongs to the concede-then-correct
 *  experiment in these marker lines. The "on" arm of the experiment sees the
 *  wrapped content with the marker lines removed. The "off" arm sees the
 *  document exactly as it was before the experiment. topics.ts checks at load
 *  time that every enrolled topic's document contains the marker. */
export const CONCEDE_MARKER = "<!-- concede-shape -->";
const CONCEDE_BLOCK = /<!-- concede-shape -->\n([\s\S]*?)<!-- \/concede-shape -->\n/g;

function resolveConcedeBlocks(document: string, concedeArmOn: boolean): string {
  if (concedeArmOn) return document.replace(CONCEDE_BLOCK, "$1");
  // Removing a block leaves the blank lines that surrounded it on both sides.
  // We collapse them, so the control arm's document has no gaps.
  return document.replace(CONCEDE_BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

/** Builds the reference-document block that is injected into the research step. It
 *  leads with the source URL when the document has one canonical source, so the bot
 *  can cite the article directly. A document that carries its own sources for each
 *  claim renders without that line. Both simple-bot's search prompt and cheap-bot's
 *  search analyzer call this, so the format stays identical in both. Every consumer
 *  goes through here, and that is what keeps the concede A/B arms clean: the "off"
 *  arm never sees the experiment's document additions in any step. */
export function buildReferenceBlock(ctx: MonitoringContext): string {
  const sourceLine = ctx.documentUrl ? `Source URL: ${ctx.documentUrl}\n` : "";
  const document = resolveConcedeBlocks(ctx.document, getBotConfig().concede_shape === true);
  return `## Reference document (ground truth on "${ctx.topicTitle}")
${sourceLine}${document}`;
}
