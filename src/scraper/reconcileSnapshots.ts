/**
 * Snapshot reconciliation.
 *
 * The scraper writes one row per sighting into scraped_notewriter_snapshots.
 * This file turns that history into one trustworthy row per note. It gives each
 * snapshot a quality tier. It then finds notes and tweets that different
 * snapshots disagree about, settles each disagreement by majority vote, and
 * writes the surviving values into the notes table.
 *
 * The full design is written up in docs/snapshot-reconciliation.md.
 *
 * You can run this file on its own. The scraper also calls it at the end of a run.
 */

import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../api/paging";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

const RECOGNIZED_STATUSES = new Set([
  "CURRENTLY_RATED_HELPFUL",
  "CURRENTLY_RATED_NOT_HELPFUL",
  "NEEDS_MORE_RATINGS",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  groundTruth: Map<string, string> // Maps a note_id to its tweet_id, taken from the notes table.
): Tier {
  const hasRealNoteId = isRealNoteId(snap.note_id);
  const hasRealTweetId = isRealTweetId(snap.tweet_id);
  const hasRealStatus =
    snap.cn_status !== null && RECOGNIZED_STATUSES.has(snap.cn_status);
  const hasNoteText = !!snap.note_text && snap.note_text.trim().length > 0;
  const hasViewCount =
    snap.view_count !== null && snap.view_count !== undefined;
  const isCRH = snap.cn_status === "CURRENTLY_RATED_HELPFUL";
  const tweetUnavailable =
    snap.tweet_id === "post_unavailable" ||
    (snap.tweet_id !== null && snap.tweet_id.startsWith("unavailable_")) ||
    snap.tweet_id === null;

  // The snapshot is impossible when it contradicts itself. A note rated
  // currently helpful is always shown on X. So a snapshot that says both
  // "currently rated helpful" and "not shown on X" cannot be right.
  if (isCRH && snap.shown_on_x === false) {
    return "impossible";
  }

  const gtTweetId = groundTruth.get(snap.note_id);

  // The snapshot is junk when it pairs the note with a different tweet than the
  // notes table does.
  if (gtTweetId && hasRealTweetId && snap.tweet_id !== gtTweetId) {
    return "junk";
  }

  // The snapshot is also junk when it carries neither a recognised status nor
  // any note text. Such a snapshot tells us almost nothing.
  if (!hasRealStatus && !hasNoteText) {
    return "junk";
  }

  // The snapshot is platinum when its pairing matches the notes table and it
  // carries a recognised status and note text. A note rated currently helpful
  // must also carry a view count to reach platinum.
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

  // The snapshot is gold when both ids look real, the status is recognised and
  // the note text is there, but the notes table cannot confirm the pairing. A
  // note rated currently helpful must also carry a view count to reach gold.
  if (hasRealNoteId && hasRealTweetId && hasRealStatus && hasNoteText && (!isCRH || hasViewCount)) {
    // A note that the notes table knows about has already been handled. If its
    // tweet did not match it was returned as junk. If it did match it was
    // returned as platinum. So reaching this point normally means the notes
    // table has never heard of this note and the pairing cannot be checked.
    if (!gtTweetId) {
      return "gold";
    }
    // Getting here means the earlier platinum check let a matching pair through.
    // That should not happen. Gold is the safe answer, because the snapshot is
    // complete either way.
    return "gold";
  }

  // A silver snapshot is complete apart from one field. There are four ways
  // that happens.
  // The tweet is unavailable, but the note id, the status and the text are there.
  if (hasRealNoteId && hasRealStatus && hasNoteText && tweetUnavailable) {
    return "silver";
  }
  // Both ids and the text are there, but the status was not recognised.
  if (hasRealNoteId && hasRealTweetId && !hasRealStatus && hasNoteText) {
    return "silver";
  }
  // Both ids and the status are there, but the note text is missing.
  if (hasRealNoteId && hasRealTweetId && hasRealStatus && !hasNoteText) {
    return "silver";
  }
  // The note is rated currently helpful and has an id and text, but the view
  // count never loaded.
  if (isCRH && !hasViewCount && hasRealNoteId && hasNoteText) {
    return "silver";
  }

  return "junk";
}

// ---------------------------------------------------------------------------
// Step 2: Collision Detection
// ---------------------------------------------------------------------------

interface CollisionGroup {
  // Each key is a pairing written as "noteId:tweetId". The value holds every
  // snapshot that supports that pairing.
  pairings: Map<string, ClassifiedSnapshot[]>;
}

function detectCollisions(
  snapshots: ClassifiedSnapshot[],
  _groundTruth: Map<string, string>
): {
  // One entry per note_id that appears with more than one tweet_id.
  noteCollisions: Map<string, CollisionGroup>;
  // One entry per tweet_id that appears with more than one note_id.
  tweetCollisions: Map<string, CollisionGroup>;
  quarantinedSnapIds: Set<string>;
} {
  // A snapshot can only take part in a collision if we trust it at all and it
  // names a real tweet.
  const eligible = snapshots.filter(
    (s) => s.tier !== "junk" && s.tier !== "impossible" && isRealTweetId(s.tweet_id)
  );

  // For each note, the tweets it was seen with.
  const tweetsByNote = new Map<string, Map<string, ClassifiedSnapshot[]>>();
  // For each tweet, the notes it was seen with.
  const notesByTweet = new Map<string, Map<string, ClassifiedSnapshot[]>>();

  for (const snap of eligible) {
    const key = snap.tweet_id!;

    if (!tweetsByNote.has(snap.note_id))
      tweetsByNote.set(snap.note_id, new Map());
    const tweetMap = tweetsByNote.get(snap.note_id)!;
    if (!tweetMap.has(key)) tweetMap.set(key, []);
    tweetMap.get(key)!.push(snap);

    if (!notesByTweet.has(key)) notesByTweet.set(key, new Map());
    const noteMap = notesByTweet.get(key)!;
    if (!noteMap.has(snap.note_id)) noteMap.set(snap.note_id, []);
    noteMap.get(snap.note_id)!.push(snap);
  }

  const noteCollisions = new Map<string, CollisionGroup>();
  const tweetCollisions = new Map<string, CollisionGroup>();
  const quarantinedSnapIds = new Set<string>();

  // A note that was seen with more than one tweet is a collision. Every
  // snapshot involved goes into quarantine until the vote settles it.
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

  // The same thing in the other direction. A tweet that was seen with more
  // than one note is also a collision.
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
  // Both fields are null when the vote ended in a tie and nothing won.
  winnerTweetId: string | null;
  winnerNoteId: string | null;
}

function resolveCollision(
  collision: CollisionGroup,
  groundTruth: Map<string, string>,
  groundTruthReverse: Map<string, string> // Maps a tweet_id back to its note_id.
): VoteResult {
  // The notes table decides the winner whenever it knows one of the pairings.
  // Each pairingKey is a "noteId:tweetId" string we built ourselves, so the
  // split always returns exactly two non-empty parts.
  for (const pairingKey of collision.pairings.keys()) {
    const [noteId, tweetId] = pairingKey.split(":") as [string, string];
    if (groundTruth.get(noteId) === tweetId) {
      return { winnerTweetId: tweetId, winnerNoteId: noteId };
    }
    if (groundTruthReverse.get(tweetId) === noteId) {
      return { winnerTweetId: tweetId, winnerNoteId: noteId };
    }
  }

  // Otherwise each snapshot casts one vote for the pairing it saw.
  const votes = new Map<string, number>();
  for (const [pairingKey, snaps] of collision.pairings) {
    votes.set(pairingKey, snaps.length);
  }

  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return { winnerTweetId: null, winnerNoteId: null };

  // A tie between the top two pairings means we cannot pick one of them.
  if (sorted.length >= 2 && sorted[0]![1] === sorted[1]![1]) {
    return { winnerTweetId: null, winnerNoteId: null };
  }

  const [winnerKey] = sorted[0]!;
  const [winnerNoteId, winnerTweetId] = winnerKey.split(":") as [string, string];
  return { winnerTweetId, winnerNoteId };
}

// ---------------------------------------------------------------------------
// Step 4: Derive Canonical Data
// ---------------------------------------------------------------------------

interface CanonicalNote {
  note_id: string;
  tweet_id: string | null;
  cn_status: string | null;
  note_text: string | null;
  view_count: number | null;
  source_url: string | null;
  data_tier: Tier;
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
  // Maps a note_id to the tweet_id that won its collision. The value is null
  // when the vote tied and no tweet won.
  winningPairings: Map<string, string | null>,
  _quarantinedSnapIds: Set<string>
): CanonicalNote[] {
  const results: CanonicalNote[] = [];

  for (const [noteId, snaps] of snapshotsByNote) {
    const nonJunk = snaps.filter((s) => s.tier !== "junk" && s.tier !== "impossible");

    if (nonJunk.length === 0) {
      // We know the note exists, but we trust none of the data we have on it.
      // So we keep the note text and drop everything else.
      results.push({
        note_id: noteId,
        tweet_id: null,
        cn_status: null,
        note_text: snaps[0]?.note_text || null,
        view_count: null,
        source_url: null,
        data_tier: "junk",
      });
      continue;
    }

    // The best snapshot is the one from the highest tier. Among snapshots of
    // the same tier the newest one wins.
    const sorted = [...nonJunk].sort((a, b) => {
      const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (tierDiff !== 0) return tierDiff;
      return new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime();
    });

    // The early return above guarantees that nonJunk is not empty, so this
    // element exists.
    const best = sorted[0]!;

    let tweetId: string | null = best.tweet_id;

    // A note that had a collision takes the tweet the vote settled on instead.
    if (winningPairings.has(noteId)) {
      tweetId = winningPairings.get(noteId) ?? null;
    }

    // We keep the value "post_unavailable" because it says something real. The
    // post was there and X has taken it down. Every other value that is not a
    // real tweet id becomes null. That covers the "unavailable_<noteId>"
    // placeholders and a collision that the vote left unresolved.
    if (tweetId && !isRealTweetId(tweetId) && tweetId !== "post_unavailable") {
      tweetId = null;
    }

    results.push({
      note_id: noteId,
      tweet_id: tweetId,
      cn_status: best.cn_status,
      note_text: best.note_text,
      view_count: best.view_count,
      // The snapshots table has no source_url, so we cannot derive one. The
      // write step never sends this field, so the notes table keeps its value.
      source_url: null,
      data_tier: best.tier,
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

  // Step 1. Load every snapshot and the pairings the notes table already holds.
  const [snapshots, groundTruthNotes] = await Promise.all([
    fetchAllRows<Snapshot>(
      () => supabase
        .from("scraped_notewriter_snapshots")
        .select("id, note_id, tweet_id, note_text, cn_status, view_count, shown_on_x, excluded, scraped_at"),
      "id",
      { label: "reconcile.snapshots" },
    ),
    fetchAllRows<GroundTruthNote>(
      () => supabase.from("notes").select("note_id, tweet_id"),
      "note_id",
      { label: "reconcile.groundTruth" },
    ),
  ]);

  // A person can mark a snapshot as excluded by hand. Those never take part.
  const excludedCount = snapshots.filter((s) => s.excluded).length;
  const activeSnapshots = snapshots.filter((s) => !s.excluded);

  console.log(
    `[reconcile] Loaded ${snapshots.length} snapshots (${excludedCount} excluded), ${groundTruthNotes.length} ground truth notes`
  );

  const groundTruth = new Map<string, string>();
  const groundTruthReverse = new Map<string, string>();
  for (const n of groundTruthNotes) {
    if (n.note_id && n.tweet_id) {
      groundTruth.set(n.note_id, n.tweet_id);
      groundTruthReverse.set(n.tweet_id, n.note_id);
    }
  }

  // Step 2. Give every snapshot a quality tier.
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
    `[reconcile] Tiers — platinum: ${tierCounts.platinum}, gold: ${tierCounts.gold}, silver: ${tierCounts.silver}, junk: ${tierCounts.junk}, impossible: ${tierCounts.impossible}`
  );

  // Step 3. Find the notes and tweets that snapshots disagree about.
  const { noteCollisions, tweetCollisions, quarantinedSnapIds } =
    detectCollisions(classified, groundTruth);
  console.log(
    `[reconcile] Collisions — ${noteCollisions.size} note-level, ${tweetCollisions.size} tweet-level, ${quarantinedSnapIds.size} quarantined snapshots`
  );

  // Step 4. Settle each disagreement and remember which tweet won for each note.
  const winningPairings = new Map<string, string | null>();

  for (const [noteId, collision] of noteCollisions) {
    const result = resolveCollision(
      collision,
      groundTruth,
      groundTruthReverse
    );
    winningPairings.set(noteId, result.winnerTweetId);
  }

  for (const [, collision] of tweetCollisions) {
    const result = resolveCollision(
      collision,
      groundTruth,
      groundTruthReverse
    );
    if (result.winnerNoteId) {
      // A note-level collision has the final say. If this note already got an
      // answer from that loop, we leave it alone.
      if (!winningPairings.has(result.winnerNoteId)) {
        winningPairings.set(result.winnerNoteId, result.winnerTweetId);
      }
    }
  }

  // Step 5. Collect all snapshots of the same note together.
  const snapshotsByNote = new Map<string, ClassifiedSnapshot[]>();
  for (const snap of classified) {
    if (!snapshotsByNote.has(snap.note_id))
      snapshotsByNote.set(snap.note_id, []);
    snapshotsByNote.get(snap.note_id)!.push(snap);
  }

  // Step 6. Work out the one set of values we believe for each note.
  const canonical = deriveCanonicalData(
    snapshotsByNote,
    winningPairings,
    quarantinedSnapIds
  );

  // Step 7. Work out which notes we are allowed to overwrite.
  // A note that has submitted_at set is tracked by X's public Community Notes
  // data. That data owns its status, its text and its tweet id, so
  // reconciliation must not touch those fields. It may only update the view
  // count, and only when the scraped status agrees with the stored one.
  // We use submitted_at as the marker because both submitNoteForTweet and
  // updateNoteFeedback set it. The dedicated public_data_updated_at column was
  // dropped when the canonical note table was merged into notes.
  const publicDataNotes = await fetchAllRows<{
    note_id: string;
    cn_status: string | null;
  }>(
    () => supabase
      .from("notes")
      .select("note_id, cn_status")
      .not("submitted_at", "is", null),
    "note_id",
    { label: "reconcile.publicDataNotes" },
  );
  const publicDataStatus = new Map<string, string | null>(
    publicDataNotes.map((n) => [n.note_id, n.cn_status])
  );
  console.log(
    `[reconcile] ${publicDataStatus.size} notes have public data (view_count-only updates)`
  );

  console.log(`[reconcile] Writing ${canonical.length} canonical notes...`);

  // Step 8. Write the results back, leaving the public data fields alone.
  const now = new Date().toISOString();
  let fullWrites = 0;
  let viewOnlyWrites = 0;
  let viewSkippedMismatch = 0;
  const BATCH_SIZE = 100;

  const fullUpdateNotes = canonical.filter(
    (c) => !publicDataStatus.has(c.note_id)
  );
  const viewOnlyNotes = canonical.filter((c) =>
    publicDataStatus.has(c.note_id)
  );

  // Public data knows nothing about these notes, so we write every field.
  for (let i = 0; i < fullUpdateNotes.length; i += BATCH_SIZE) {
    const batch = fullUpdateNotes.slice(i, i + BATCH_SIZE);
    const rows = batch.map((c) => ({
      note_id: c.note_id,
      tweet_id: c.tweet_id ?? `unavailable_${c.note_id}`,
      cn_status: c.cn_status,
      note_text: c.note_text,
      view_count: c.view_count,
      data_tier: c.data_tier,
      last_reconciled_at: now,
    }));

    const { error } = await supabase
      .from("notes")
      .upsert(rows, { onConflict: "note_id" });

    if (error) {
      console.error(
        `[reconcile] Error writing full batch at offset ${i}:`,
        error
      );
    } else {
      fullWrites += batch.length;
    }
  }

  // Public data owns these notes. We only refresh the view count and the two
  // fields that record what reconciliation did.
  for (const c of viewOnlyNotes) {
    const canonicalStatus = publicDataStatus.get(c.note_id);
    const statusMatches =
      c.cn_status !== null && c.cn_status === canonicalStatus;

    const row: Record<string, any> = {
      data_tier: c.data_tier,
      last_reconciled_at: now,
    };

    if (statusMatches && c.view_count !== null) {
      row.view_count = c.view_count;
    } else if (!statusMatches && c.view_count !== null) {
      viewSkippedMismatch++;
    }

    const { error } = await supabase
      .from("notes")
      .update(row)
      .eq("note_id", c.note_id);

    if (error) {
      console.error(
        `[reconcile] Error updating view-only note ${c.note_id}:`,
        error
      );
    } else {
      viewOnlyWrites++;
    }
  }

  console.log(
    `[reconcile] Done. Full writes: ${fullWrites}, view-only updates: ${viewOnlyWrites}, view_count skipped (status mismatch): ${viewSkippedMismatch}`
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
        `Tiers: platinum=${result.tierCounts.platinum} gold=${result.tierCounts.gold} silver=${result.tierCounts.silver} junk=${result.tierCounts.junk} impossible=${result.tierCounts.impossible}`
      );
      console.log(
        `Collisions: ${result.collisions.note} note-level, ${result.collisions.tweet} tweet-level`
      );
      console.log(`Quarantined: ${result.quarantined}`);
      console.log(`Notes written: ${result.notesWritten} (full: ${result.fullWrites}, view-only: ${result.viewOnlyWrites})`);
      console.log(`View updates skipped (status mismatch): ${result.viewSkippedMismatch}`);
    })
    .catch((err) => {
      console.error("Reconciliation failed:", err);
      process.exit(1);
    });
}
