/**
 * Per-post monitoring context for the XXL-feed misinfo pre-pass.
 *
 * Mirrors the withBotConfig / withTweetLog AsyncLocalStorage pattern. Kept
 * separate from BotConfig because the reference document is per-post run
 * context (which misinfo topic this post matched), not an A/B variant.
 *
 * Regular small-feed posts run with no monitoring context (getMonitoringContext
 * returns undefined → no document injection).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface MonitoringContext {
  topicId: string;
  topicTitle: string;
  /** Canonical source URL of the reference article — leads the injected block
   *  so the bot can cite it directly in the note. */
  documentUrl: string;
  /** Full undistilled article, injected into the bot's research step. */
  document: string;
}

const storage = new AsyncLocalStorage<MonitoringContext>();

export function withMonitoringContext<T>(ctx: MonitoringContext | undefined, fn: () => T): T {
  return ctx ? storage.run(ctx, fn) : fn();
}

export function getMonitoringContext(): MonitoringContext | undefined {
  return storage.getStore();
}

/** The reference-document block injected into the research step. Leads with the
 *  source URL so the bot can cite the article directly. Shared by simple-bot's
 *  search prompt and cheap-bot's search analyzer so the format stays identical. */
export function buildReferenceBlock(ctx: MonitoringContext): string {
  return `## Reference document (ground truth on "${ctx.topicTitle}")
Source URL: ${ctx.documentUrl}
${ctx.document}`;
}
