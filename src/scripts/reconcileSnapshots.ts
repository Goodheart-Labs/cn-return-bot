// @ts-nocheck
/**
 * Snapshot Reconciliation
 *
 * Classifies scraped_notewriter_snapshots by quality tier, detects pairing
 * collisions, resolves them by majority vote, and writes canonical data to
 * canonical_note_information.
 *
 * See docs/snapshot-reconciliation.md for the full design.
 *
 * Can be run standalone or called from the scraper at the end of a run.
 */

import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  id: string;
  note_id: string;
  tweet_id: string | null;
  note_text: string | null;
  cn_status: string | null;
  view_count: number | null;
  shown_on_x: boolean | null;
  excluded: boolean | null;
  scraped_at: string;
}

interface GroundTruthNote {
  note_id: string;
  tweet_id: string;
}

export type Tier = "platinum" | "gold" | "silver" | "junk" | "impossible";

export interface ClassifiedSnapshot extends Snapshot {
  tier: Tier;
}

const RECOGNIZED_STATUSES = new Set(["CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL", "NEEDS_MORE_RATINGS"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function isRealTweetId(tweetId: string | null | undefined): boolean {
  if (!tweetId) return false;
  if (tweetId === "post_unavailable") return false;
  if (tweetId.startsWith("unavailable_")) return false;
  if (tweetId.startsWith("tweet_")) return false;
  return /^\d{10,20}$/.test(tweetId);
}

function isRealNoteId(noteId: string): boolean {
  if (noteId.startsWith("tweet_")) return false;
  return /^\d{10,20}$/.test(noteId);
}

// ---------------------------------------------------------------------------
// Step 1: Quality Tier Classification
// ---------------------------------------------------------------------------

export function classifySnapshot(
  snap: Snapshot,
  groundTruth: Map<string, string>, // note_id -> tweet_id from notes table
): Tier {
  const hasRealNoteId = isRealNoteId(snap.note_id);
  const hasRealTweetId = isRealTweetId(snap.tweet_id);
  const hasRealStatus = snap.cn_status !== null && RECOGNIZED_STATUSES.has(snap.cn_status);
  const hasNoteText = !!snap.note_text && snap.note_text.trim().length > 0;
  const hasViewCount = snap.view_count !== null && snap.view_count !== undefined;
  const isCRH = snap.cn_status === "CURRENTLY_RATED_HELPFUL";
  const tweetUnavailable =
    snap.tweet_id === "post_unavailable" ||
    (snap.tweet_id !== null && snap.tweet_id.startsWith("unavailable_")) ||
    snap.tweet_id === null;

  // Impossible: data actively contradicts itself
  // CRH notes are shown on X — if shown_on_x is explicitly false, something is wrong
  if (isCRH && snap.shown_on_x === false) {
    return "impossible";
  }

  // Check ground truth
  const gtTweetId = groundTruth.get(snap.note_id);

  // Junk: contradicts ground truth
  if (gtTweetId && hasRealTweetId && snap.tweet_id !== gtTweetId) {
    return "junk";
  }

  // Junk: UNKNOWN status AND no note text (got basically nothing)
  if (!hasRealStatus && !hasNoteText) {
    return "junk";
  }

  // Platinum: pair matches ground truth, real status, has text
  // CRH notes must also have view_count to be platinum
  if (
    gtTweetId &&
    hasRealTweetId &&
    snap.tweet_id === gtTweetId &&
    hasRealStatus &&
    hasNoteText &&
    (!isCRH || hasViewCount)
  ) {
    return "platinum";
  }

  // Gold: real pair, neither ID in ground truth, complete
  // CRH notes must also have view_count to be gold
  if (hasRealNoteId && hasRealTweetId && hasRealStatus && hasNoteText && (!isCRH || hasViewCount)) {
    // If note_id IS in ground truth but tweet_id doesn't match, it was already
    // caught as junk above. If it matches, it was caught as platinum.
    // So if we're here with a real pair, it's either not in GT at all,
    // or the note_id is in GT and the tweet_id matches (already platinum).
    // Therefore this is gold (unverifiable pair).
    if (!gtTweetId) {
      return "gold";
    }
    // If gtTweetId exists and matches, should have been platinum — but in case
    // of a logic edge, fall through to gold rather than mis-classifying.
    return "gold";
  }

  // Silver: mostly complete, one thing missing
  // Case 1: has note_id + real status + note_text, but tweet unavailable
  if (hasRealNoteId && hasRealStatus && hasNoteText && tweetUnavailable) {
    return "silver";
  }
  // Case 2: has real pair but cn_status is UNKNOWN
  if (hasRealNoteId && hasRealTweetId && !hasRealStatus && hasNoteText) {
    return "silver";
  }
  // Case 3: has real pair + real status but note_text is missing
  if (hasRealNoteId && hasRealTweetId && hasRealStatus && !hasNoteText) {
    return "silver";
  }
  // Case 4: CRH with real pair + note_text but no view_count (view count didn't load)
  if (isCRH && !hasViewCount && hasRealNoteId && hasNoteText) {
    return "silver";
  }

  // Everything else is junk
  return "junk";
}

// ---------------------------------------------------------------------------
// Step 2: Collision Detection
// ---------------------------------------------------------------------------

interface CollisionGroup {
  // The conflicting pairings and which snapshots support each
  pairings: Map<string, ClassifiedSnapshot[]>; // "noteId:tweetId" -> snapshots
}

function detectCollisions(
  snapshots: ClassifiedSnapshot[],
  groundTruth: Map<string, string>,
): {
  // Collisions keyed by the conflicting dimension
  noteCollisions: Map<string, CollisionGroup>; // note_id -> collision
  tweetCollisions: Map<string, CollisionGroup>; // tweet_id -> collision
  quarantinedSnapIds: Set<string>;
} {
  // Only consider non-junk snapshots with real tweet_ids for collision detection
  const eligible = snapshots.filter((s) => s.tier !== "junk" && s.tier !== "impossible" && isRealTweetId(s.tweet_id));

  // Group by note_id → set of tweet_ids
  const tweetsByNote = new Map<string, Map<string, ClassifiedSnapshot[]>>();
  // Group by tweet_id → set of note_ids
  const notesByTweet = new Map<string, Map<string, ClassifiedSnapshot[]>>();

  for (const snap of eligible) {
    const key = snap.tweet_id!;

    // note → tweets
    if (!tweetsByNote.has(snap.note_id)) tweetsByNote.set(snap.note_id, new Map());
    const tweetMap = tweetsByNote.get(snap.note_id)!;
    if (!tweetMap.has(key)) tweetMap.set(key, []);
    tweetMap.get(key)!.push(snap);

    // tweet → notes
    if (!notesByTweet.has(key)) notesByTweet.set(key, new Map());
    const noteMap = notesByTweet.get(key)!;
    if (!noteMap.has(snap.note_id)) noteMap.set(snap.note_id, []);
    noteMap.get(snap.note_id)!.push(snap);
  }

  const noteCollisions = new Map<string, CollisionGroup>();
  const tweetCollisions = new Map<string, CollisionGroup>();
  const quarantinedSnapIds = new Set<string>();

  // Same note_id, different tweet_ids
  for (const [noteId, tweetMap] of tweetsByNote) {
    if (tweetMap.size > 1) {
      const pairings = new Map<string, ClassifiedSnapshot[]>();
      for (const [tweetId, snaps] of tweetMap) {
        pairings.set(`${noteId}:${tweetId}`, snaps);
        for (const s of snaps) quarantinedSnapIds.add(s.id);
      }
      noteCollisions.set(noteId, { pairings });
    }
  }

  // Same tweet_id, different note_ids
  for (const [tweetId, noteMap] of notesByTweet) {
    if (noteMap.size > 1) {
      const pairings = new Map<string, ClassifiedSnapshot[]>();
      for (const [noteId, snaps] of noteMap) {
        pairings.set(`${noteId}:${tweetId}`, snaps);
        for (const s of snaps) quarantinedSnapIds.add(s.id);
      }
      tweetCollisions.set(tweetId, { pairings });
    }
  }

  return { noteCollisions, tweetCollisions, quarantinedSnapIds };
}

// ---------------------------------------------------------------------------
// Step 3: Majority Vote Resolution
// ---------------------------------------------------------------------------

interface VoteResult {
  winnerTweetId: string | null; // null = tie, no winner
  winnerNoteId: string | null;
}

function resolveCollision(
  collision: CollisionGroup,
  groundTruth: Map<string, string>,
  groundTruthReverse: Map<string, string>, // tweet_id -> note_id
): VoteResult {
  // Check if ground truth resolves this
  for (const [pairingKey, snaps] of collision.pairings) {
    const [noteId, tweetId] = pairingKey.split(":");
    // If notes table says this note_id goes with this tweet_id, that wins
    if (groundTruth.get(noteId) === tweetId) {
      return { winnerTweetId: tweetId, winnerNoteId: noteId };
    }
    // If notes table says this tweet_id goes with this note_id, that wins
    if (groundTruthReverse.get(tweetId) === noteId) {
      return { winnerTweetId: tweetId, winnerNoteId: noteId };
    }
  }

  // Count votes per pairing
  const votes = new Map<string, number>(); // "noteId:tweetId" -> count
  for (const [pairingKey, snaps] of collision.pairings) {
    votes.set(pairingKey, snaps.length);
  }

  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return { winnerTweetId: null, winnerNoteId: null };

  // Check for tie
  if (sorted.length >= 2 && sorted[0][1] === sorted[1][1]) {
    return { winnerTweetId: null, winnerNoteId: null };
  }

  const [winnerKey] = sorted[0];
  const [winnerNoteId, winnerTweetId] = winnerKey.split(":");
  return { winnerTweetId, winnerNoteId };
}

// ---------------------------------------------------------------------------
// Step 4: Coherence Scoring
// ---------------------------------------------------------------------------

/**
 * Measures how consistent the non-junk snapshots for a note are.
 * Starts at 1.0, applies penalties for contradictions.
 *
 * Penalties:
 * - Text differs between snapshots:     -0.4 (notes can't be edited, so this = scraper bug)
 * - View count decreases over time:     -0.3 per occurrence (views are monotonically increasing)
 * - Status flips (helpful ↔ not helpful): -0.2 per flip (rare but possible)
 * - Status regresses (rated → needs more): -0.1 per occurrence
 *
 * Returns 1.0 if there's only one snapshot (nothing to contradict).
 */
export function scoreCoherence(snapshots: ClassifiedSnapshot[]): number {
  const nonJunk = snapshots.filter((s) => s.tier !== "junk" && s.tier !== "impossible");
  if (nonJunk.length <= 1) return 1.0;

  let score = 1.0;

  // Sort chronologically for time-series checks
  const chronological = [...nonJunk].sort(
    (a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime(),
  );

  // --- Text consistency ---
  // Normalize and deduplicate texts
  const texts = new Set(
    nonJunk.filter((s) => s.note_text && s.note_text.trim().length > 0).map((s) => s.note_text!.trim()),
  );
  if (texts.size > 1) {
    // Multiple distinct texts = scraper grabbed wrong modal
    score -= 0.4;
  }

  // --- View count monotonicity ---
  const withViews = chronological.filter((s) => s.view_count !== null && s.view_count !== undefined);
  for (let i = 1; i < withViews.length; i++) {
    if (withViews[i].view_count! < withViews[i - 1].view_count!) {
      score -= 0.3;
    }
  }

  // --- Status transition sensibility ---
  const RATED = new Set(["CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"]);
  const withStatus = chronological.filter((s) => s.cn_status !== null && RECOGNIZED_STATUSES.has(s.cn_status));
  for (let i = 1; i < withStatus.length; i++) {
    const prev = withStatus[i - 1].cn_status!;
    const curr = withStatus[i].cn_status!;
    if (prev === curr) continue;

    // Flip: helpful ↔ not helpful
    if (RATED.has(prev) && RATED.has(curr)) {
      score -= 0.2;
    }
    // Regression: rated → needs more ratings
    else if (RATED.has(prev) && curr === "NEEDS_MORE_RATINGS") {
      score -= 0.1;
    }
    // Normal progression: needs more → rated — no penalty
  }

  return Math.max(0, Math.round(score * 100) / 100);
}

// ---------------------------------------------------------------------------
// Step 5: Derive Canonical Data
// ---------------------------------------------------------------------------

interface CanonicalNote {
  note_id: string;
  tweet_id: string | null;
  cn_status: string | null;
  note_text: string | null;
  view_count: number | null;
  source_url: string | null;
  data_tier: Tier;
  coherence_score: number;
}

const TIER_RANK: Record<Tier, number> = {
  platinum: 4,
  gold: 3,
  silver: 2,
  junk: 1,
  impossible: 0,
};

function deriveCanonicalData(
  snapshotsByNote: Map<string, ClassifiedSnapshot[]>,
  winningPairings: Map<string, string | null>, // note_id -> winning tweet_id (null = tie)
  quarantinedSnapIds: Set<string>,
): CanonicalNote[] {
  const results: CanonicalNote[] = [];

  for (const [noteId, snaps] of snapshotsByNote) {
    // Filter out junk for selecting best snapshot
    const nonJunk = snaps.filter((s) => s.tier !== "junk" && s.tier !== "impossible");

    if (nonJunk.length === 0) {
      // All junk — note exists but we don't trust any data
      results.push({
        note_id: noteId,
        tweet_id: null,
        cn_status: null,
        note_text: snaps[0]?.note_text || null,
        view_count: null,
        source_url: null,
        data_tier: "junk",
        coherence_score: scoreCoherence(snaps),
      });
      continue;
    }

    // Sort by tier (highest first), then by scraped_at (newest first)
    const sorted = [...nonJunk].sort((a, b) => {
      const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (tierDiff !== 0) return tierDiff;
      return new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime();
    });

    const best = sorted[0];

    // Determine tweet_id
    let tweetId: string | null = best.tweet_id;

    // If this note had collisions, use the winning pairing
    if (winningPairings.has(noteId)) {
      tweetId = winningPairings.get(noteId) ?? null;
    }

    // Preserve post_unavailable/unavailable_* as-is (they're meaningful)
    // But if tweet_id is a placeholder or the collision was unresolved, set null
    if (tweetId && !isRealTweetId(tweetId) && tweetId !== "post_unavailable") {
      tweetId = null;
    }

    results.push({
      note_id: noteId,
      tweet_id: tweetId,
      cn_status: best.cn_status,
      note_text: best.note_text,
      view_count: best.view_count,
      source_url: null, // snapshots don't have source_url; keep existing
      data_tier: best.tier,
      coherence_score: scoreCoherence(snaps),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main: Run Reconciliation
// ---------------------------------------------------------------------------

export async function reconcile(): Promise<{
  totalSnapshots: number;
  tierCounts: Record<Tier, number>;
  collisions: { note: number; tweet: number };
  quarantined: number;
  notesWritten: number;
  fullWrites: number;
  viewOnlyWrites: number;
  viewSkippedMismatch: number;
}> {
  console.log("[reconcile] Starting snapshot reconciliation...");

  // 1. Fetch all data
  const [snapshots, groundTruthNotes] = await Promise.all([
    fetchAll<Snapshot>(() =>
      supabase
        .from("scraped_notewriter_snapshots")
        .select("id, note_id, tweet_id, note_text, cn_status, view_count, shown_on_x, excluded, scraped_at"),
    ),
    fetchAll<GroundTruthNote>(() => supabase.from("notes").select("note_id, tweet_id")),
  ]);

  // Filter out manually excluded snapshots
  const excludedCount = snapshots.filter((s) => s.excluded).length;
  const activeSnapshots = snapshots.filter((s) => !s.excluded);

  console.log(
    `[reconcile] Loaded ${snapshots.length} snapshots (${excludedCount} excluded), ${groundTruthNotes.length} ground truth notes`,
  );

  // Build ground truth maps
  const groundTruth = new Map<string, string>();
  const groundTruthReverse = new Map<string, string>();
  for (const n of groundTruthNotes) {
    if (n.note_id && n.tweet_id) {
      groundTruth.set(n.note_id, n.tweet_id);
      groundTruthReverse.set(n.tweet_id, n.note_id);
    }
  }

  // 2. Classify each snapshot
  const classified: ClassifiedSnapshot[] = activeSnapshots.map((snap) => ({
    ...snap,
    tier: classifySnapshot(snap, groundTruth),
  }));

  const tierCounts: Record<Tier, number> = {
    platinum: 0,
    gold: 0,
    silver: 0,
    junk: 0,
    impossible: 0,
  };
  for (const s of classified) tierCounts[s.tier]++;
  console.log(
    `[reconcile] Tiers — platinum: ${tierCounts.platinum}, gold: ${tierCounts.gold}, silver: ${tierCounts.silver}, junk: ${tierCounts.junk}, impossible: ${tierCounts.impossible}`,
  );

  // 3. Detect collisions
  const { noteCollisions, tweetCollisions, quarantinedSnapIds } = detectCollisions(classified, groundTruth);
  console.log(
    `[reconcile] Collisions — ${noteCollisions.size} note-level, ${tweetCollisions.size} tweet-level, ${quarantinedSnapIds.size} quarantined snapshots`,
  );

  // 4. Resolve collisions
  const winningPairings = new Map<string, string | null>(); // note_id -> winning tweet_id

  for (const [noteId, collision] of noteCollisions) {
    const result = resolveCollision(collision, groundTruth, groundTruthReverse);
    winningPairings.set(noteId, result.winnerTweetId);
  }

  for (const [tweetId, collision] of tweetCollisions) {
    const result = resolveCollision(collision, groundTruth, groundTruthReverse);
    if (result.winnerNoteId) {
      // Only set if not already set by a note-level collision
      if (!winningPairings.has(result.winnerNoteId)) {
        winningPairings.set(result.winnerNoteId, result.winnerTweetId);
      }
    }
  }

  // 5. Group snapshots by note_id
  const snapshotsByNote = new Map<string, ClassifiedSnapshot[]>();
  for (const snap of classified) {
    if (!snapshotsByNote.has(snap.note_id)) snapshotsByNote.set(snap.note_id, []);
    snapshotsByNote.get(snap.note_id)!.push(snap);
  }

  // 6. Derive canonical data
  const canonical = deriveCanonicalData(snapshotsByNote, winningPairings, quarantinedSnapIds);

  // 7. Fetch public data status to determine write authority
  //    Notes with public_data_updated_at set are owned by public data for
  //    status/text/tweet_id — reconciliation can only update view_count
  //    (and only if the scraper's status matches the canonical status).
  const publicDataNotes = await fetchAll<{
    note_id: string;
    cn_status: string | null;
  }>(() =>
    supabase.from("canonical_note_information").select("note_id, cn_status").not("public_data_updated_at", "is", null),
  );
  const publicDataStatus = new Map<string, string | null>(publicDataNotes.map((n) => [n.note_id, n.cn_status]));
  console.log(`[reconcile] ${publicDataStatus.size} notes have public data (view_count-only updates)`);

  console.log(`[reconcile] Writing ${canonical.length} canonical notes...`);

  // 8. Write to canonical_note_information, respecting public data authority
  const now = new Date().toISOString();
  let fullWrites = 0;
  let viewOnlyWrites = 0;
  let viewSkippedMismatch = 0;
  const BATCH_SIZE = 100;

  // Split canonical notes into two groups
  const fullUpdateNotes = canonical.filter((c) => !publicDataStatus.has(c.note_id));
  const viewOnlyNotes = canonical.filter((c) => publicDataStatus.has(c.note_id));

  // Case B: Notes NOT in public data — full write (existing behavior)
  for (let i = 0; i < fullUpdateNotes.length; i += BATCH_SIZE) {
    const batch = fullUpdateNotes.slice(i, i + BATCH_SIZE);
    const rows = batch.map((c) => ({
      note_id: c.note_id,
      tweet_id: c.tweet_id ?? `unavailable_${c.note_id}`,
      cn_status: c.cn_status,
      note_text: c.note_text,
      view_count: c.view_count,
      data_tier: c.data_tier,
      coherence_score: c.coherence_score,
      last_reconciled_at: now,
    }));

    const { error } = await supabase.from("canonical_note_information").upsert(rows, { onConflict: "note_id" });

    if (error) {
      console.error(`[reconcile] Error writing full batch at offset ${i}:`, error);
    } else {
      fullWrites += batch.length;
    }
  }

  // Case A: Notes IN public data — only update view_count + reconciliation metadata
  for (const c of viewOnlyNotes) {
    const canonicalStatus = publicDataStatus.get(c.note_id);
    const statusMatches = c.cn_status !== null && c.cn_status === canonicalStatus;

    const row: Record<string, any> = {
      data_tier: c.data_tier,
      coherence_score: c.coherence_score,
      last_reconciled_at: now,
    };

    if (statusMatches && c.view_count !== null) {
      row.view_count = c.view_count;
    } else if (!statusMatches && c.view_count !== null) {
      viewSkippedMismatch++;
    }

    const { error } = await supabase.from("canonical_note_information").update(row).eq("note_id", c.note_id);

    if (error) {
      console.error(`[reconcile] Error updating view-only note ${c.note_id}:`, error);
    } else {
      viewOnlyWrites++;
    }
  }

  console.log(
    `[reconcile] Done. Full writes: ${fullWrites}, view-only updates: ${viewOnlyWrites}, view_count skipped (status mismatch): ${viewSkippedMismatch}`,
  );

  return {
    totalSnapshots: activeSnapshots.length,
    tierCounts,
    collisions: {
      note: noteCollisions.size,
      tweet: tweetCollisions.size,
    },
    quarantined: quarantinedSnapIds.size,
    notesWritten: fullWrites + viewOnlyWrites,
    fullWrites,
    viewOnlyWrites,
    viewSkippedMismatch,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  reconcile()
    .then((result) => {
      console.log("\n=== Reconciliation Summary ===");
      console.log(`Total snapshots: ${result.totalSnapshots}`);
      console.log(
        `Tiers: platinum=${result.tierCounts.platinum} gold=${result.tierCounts.gold} silver=${result.tierCounts.silver} junk=${result.tierCounts.junk} impossible=${result.tierCounts.impossible}`,
      );
      console.log(`Collisions: ${result.collisions.note} note-level, ${result.collisions.tweet} tweet-level`);
      console.log(`Quarantined: ${result.quarantined}`);
      console.log(
        `Notes written: ${result.notesWritten} (full: ${result.fullWrites}, view-only: ${result.viewOnlyWrites})`,
      );
      console.log(`View updates skipped (status mismatch): ${result.viewSkippedMismatch}`);
    })
    .catch((err) => {
      console.error("Reconciliation failed:", err);
      process.exit(1);
    });
}
