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
import type { MisinfoTopicId } from "./topicIds";
import { getBotConfig } from "../ab-testing/botConfig";

export interface MonitoringContext {
  topicId: MisinfoTopicId;
  topicTitle: string;
  /** Canonical source URL of the reference article — leads the injected block
   *  so the bot can cite it directly in the note. Absent for hand-authored
   *  documents that carry their own per-claim sources. */
  documentUrl?: string;
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

/** A topic document wraps content that belongs to the concede-then-correct
 *  experiment in these marker lines. The "on" arm sees the content with the
 *  marker lines removed; the "off" arm sees the document exactly as it was
 *  before the experiment. */
const CONCEDE_BLOCK = /<!-- concede-shape -->\n([\s\S]*?)<!-- \/concede-shape -->\n/g;

function resolveConcedeBlocks(document: string, concedeArmOn: boolean): string {
  if (concedeArmOn) return document.replace(CONCEDE_BLOCK, "$1");
  // Removing a block leaves the blank lines that surrounded it on both sides;
  // collapse them so the control arm's document has no gaps.
  return document.replace(CONCEDE_BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

/** The reference-document block injected into the research step. Leads with the
 *  source URL (when the document has one canonical source) so the bot can cite
 *  the article directly; documents carrying their own per-claim sources render
 *  without it. Shared by simple-bot's search prompt and cheap-bot's search
 *  analyzer so the format stays identical. Every consumer goes through here,
 *  which is what keeps the concede A/B arms clean: the "off" arm never sees
 *  the experiment's document additions in any step. */
export function buildReferenceBlock(ctx: MonitoringContext): string {
  const sourceLine = ctx.documentUrl ? `Source URL: ${ctx.documentUrl}\n` : "";
  const document = resolveConcedeBlocks(ctx.document, getBotConfig().concede_shape === true);
  return `## Reference document (ground truth on "${ctx.topicTitle}")
${sourceLine}${document}`;
}
