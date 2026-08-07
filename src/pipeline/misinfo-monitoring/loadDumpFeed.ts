/**
 * Local testing helper for the misinfo pre-pass.
 *
 * The live XXL feed is only reachable from GitHub Actions, which holds the
 * production account's credentials. A local run gets a 403 instead. To exercise the
 * pre-pass on real XXL data, point it at a feed dump that was pulled earlier. One
 * such dump is scripts_jim/2026_05_29_xxl_feed_monitor/from_actions/feed_dump.jsonl.
 *
 * This maps the dump's record shape onto the production Post shape. The dump holds
 * no media URLs, so every post is treated as text only and gets an empty media list.
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
