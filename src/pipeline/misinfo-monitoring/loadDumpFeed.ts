/**
 * Local-testing affordance for the misinfo pre-pass.
 *
 * The live XXL feed is only accessible from GitHub Actions (the prod secret
 * account); locally it 403s. To exercise the pre-pass on real XXL data, point
 * it at an already-pulled feed dump (e.g. the investigation's
 * scripts_jim/2026_05_29_xxl_feed_monitor/from_actions/feed_dump.jsonl).
 *
 * Maps the dump's record schema onto the production Post shape. Media URLs
 * aren't in the dump, so posts are treated as text-only (media: []).
 */

import { readFileSync } from "node:fs";
import type { Post } from "../../api/fetchEligiblePosts";

interface DumpRecord {
  id: string;
  created_at?: string;
  author_name?: string;
  author_description?: string;
  author_followers?: number;
  text?: string;
  quoted_text?: string;
  quoted_author_id?: string;
  impressions?: number;
  likes?: number;
}

function toPost(rec: DumpRecord): Post {
  return {
    id: rec.id,
    author_id: "",
    created_at: rec.created_at ?? "",
    text: rec.text ?? "",
    media: [],
    referenced_tweet_data: rec.quoted_text
      ? { id: "", author_id: rec.quoted_author_id ?? "", created_at: "", text: rec.quoted_text }
      : undefined,
    public_metrics: { impression_count: rec.impressions, like_count: rec.likes },
    author_followers: rec.author_followers,
    author_name: rec.author_name,
    author_description: rec.author_description,
  };
}

export function loadDumpFeed(path: string): Post[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => toPost(JSON.parse(line) as DumpRecord));
}
