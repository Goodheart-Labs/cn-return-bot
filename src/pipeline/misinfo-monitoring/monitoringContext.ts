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

/** Builds the reference-document block that is injected into the research step. It
 *  leads with the source URL when the document has one canonical source, so the bot
 *  can cite the article directly. A document that carries its own sources for each
 *  claim renders without that line. Both simple-bot's search prompt and cheap-bot's
 *  search analyzer call this, so the format stays identical in both. */
export function buildReferenceBlock(ctx: MonitoringContext): string {
  const sourceLine = ctx.documentUrl ? `Source URL: ${ctx.documentUrl}\n` : "";
  return `## Reference document (ground truth on "${ctx.topicTitle}")
${sourceLine}${ctx.document}`;
}
