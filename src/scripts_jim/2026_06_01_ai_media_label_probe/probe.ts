/**
 * Probe the Community Notes "posts_eligible_for_notes" endpoint to discover
 * EVERY field X actually returns — looking specifically for any AI-generated /
 * synthetic-media / provenance label on tweets or media objects.
 *
 * Strategy:
 *  1. Request the full documented media.fields set + alt_text, dump raw JSON
 *     for the first few posts that have media, and print the union of all keys
 *     seen on tweet objects and on media objects (so undocumented keys surface).
 *  2. Separately try requesting a list of CANDIDATE AI field names — X returns a
 *     400 "invalid fields" error naming any field it doesn't recognize, which
 *     tells us definitively whether such a field exists.
 *
 * Read-only. Uses prod X read keys (allowed per CLAUDE.md).
 */

import "dotenv/config";

// Use the raw X_* prod keys (the project-enrolled notewriter app) — only this app
// can call posts_eligible_for_notes. This probe is read-only (a GET), which CLAUDE.md
// permits with the prod read keys.
console.log(`[probe] using prod X_API_KEY ...${process.env.X_API_KEY?.slice(-6)}`);

import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

async function call(params: URLSearchParams) {
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  return axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30000,
  });
}

function collectKeys(objs: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of objs ?? []) {
    for (const k of Object.keys(o ?? {})) counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

async function dumpFullResponse() {
  const params = new URLSearchParams({
    "tweet.fields":
      "created_at,author_id,attachments,text,media_metadata,matched_media_notes,note_request_suggestions,suggested_source_links,possibly_sensitive,context_annotations",
    "media.fields":
      "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants,alt_text",
    expansions:
      "attachments.media_keys,author_id",
    max_results: "100",
    test_mode: "true",
  });

  console.log(`\n===== FULL RESPONSE PROBE =====`);
  try {
    const resp = await call(params);
    const data = resp.data;
    console.log(`[probe] status=${resp.status}`);
    console.log(`[probe] #posts=${data.data?.length ?? 0} #media=${data.includes?.media?.length ?? 0}`);

    console.log(`\n[probe] UNION of keys on tweet objects (data[]):`);
    console.log(JSON.stringify(collectKeys(data.data), null, 2));

    console.log(`\n[probe] UNION of keys on media objects (includes.media[]):`);
    console.log(JSON.stringify(collectKeys(data.includes?.media), null, 2));

    const mediaPosts = (data.data ?? []).filter((t: any) => t.attachments?.media_keys?.length);
    console.log(`\n[probe] ${mediaPosts.length}/${data.data?.length ?? 0} posts have media`);

    console.log(`\n[probe] First 3 media objects verbatim:`);
    console.log(JSON.stringify((data.includes?.media ?? []).slice(0, 3), null, 2));

    console.log(`\n[probe] First post with media, verbatim:`);
    console.log(JSON.stringify(mediaPosts[0] ?? null, null, 2));

    // The decisive check: union of keys INSIDE media_metadata[] entries, across all posts.
    const allMetaEntries: any[] = [];
    for (const t of data.data ?? []) {
      for (const m of t.media_metadata ?? []) allMetaEntries.push(m);
    }
    console.log(`\n[probe] total media_metadata entries: ${allMetaEntries.length}`);
    console.log(`[probe] UNION of keys inside media_metadata entries:`);
    console.log(JSON.stringify(collectKeys(allMetaEntries), null, 2));

    const richMeta = allMetaEntries.filter((m) => Object.keys(m).length > 1);
    console.log(`\n[probe] media_metadata entries with >1 key: ${richMeta.length}`);
    console.log(JSON.stringify(richMeta.slice(0, 10), null, 2));

    // Same union check for matched_media_notes (CN-specific) if present.
    const allMatched: any[] = [];
    for (const t of data.data ?? []) {
      for (const m of t.matched_media_notes ?? []) allMatched.push(m);
    }
    console.log(`\n[probe] total matched_media_notes entries: ${allMatched.length}`);
    if (allMatched.length) {
      console.log(`[probe] UNION of keys inside matched_media_notes:`);
      console.log(JSON.stringify(collectKeys(allMatched), null, 2));
      console.log(JSON.stringify(allMatched.slice(0, 5), null, 2));
    }
  } catch (err: any) {
    console.log(`[probe] FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
    if (err.response?.data) console.log(JSON.stringify(err.response.data, null, 2));
  }
}

async function probeCandidateFields() {
  const candidates = [
    "ai_generated",
    "ai_metadata",
    "grok_metadata",
    "media_metadata",
    "synthetic",
    "synthetic_media",
    "manipulated_media",
    "source_metadata",
    "provenance",
    "c2pa",
    "content_provenance",
    "media_source",
    "is_ai_generated",
    "generated_by_ai",
  ];

  console.log(`\n\n===== CANDIDATE AI FIELD PROBE (media.fields) =====`);
  for (const field of candidates) {
    const params = new URLSearchParams({
      "media.fields": `type,${field}`,
      expansions: "attachments.media_keys",
      max_results: "10",
      test_mode: "false",
    });
    try {
      const resp = await call(params);
      console.log(`[probe] media.fields "${field}" => ACCEPTED (status ${resp.status}) — field likely EXISTS`);
    } catch (err: any) {
      const body = err.response?.data;
      const detail = body?.errors?.[0]?.message ?? body?.detail ?? err.message;
      console.log(`[probe] media.fields "${field}" => ${err.response?.status}: ${detail}`);
    }
  }

  const tweetCandidates = ["ai_generated", "media_metadata", "grok_analysis", "ai_metadata"];
  console.log(`\n===== CANDIDATE AI FIELD PROBE (tweet.fields) =====`);
  for (const field of tweetCandidates) {
    const params = new URLSearchParams({
      "tweet.fields": `created_at,${field}`,
      max_results: "10",
      test_mode: "false",
    });
    try {
      const resp = await call(params);
      console.log(`[probe] tweet.fields "${field}" => ACCEPTED (status ${resp.status}) — field likely EXISTS`);
    } catch (err: any) {
      const body = err.response?.data;
      const detail = body?.errors?.[0]?.message ?? body?.detail ?? err.message;
      console.log(`[probe] tweet.fields "${field}" => ${err.response?.status}: ${detail}`);
    }
  }
}

// Fetch REAL tweets via the standard /2/tweets endpoint (real, non-test data) and
// inspect their media_metadata for any sub-field beyond media_key (e.g. an AI label).
async function probeRealTweetsMediaMetadata() {
  console.log(`\n\n===== REAL TWEET media_metadata PROBE (/2/tweets) =====`);

  // 1) Pull real candidate post IDs from a fresh test-mode eligible-posts call:
  //    its note_request_suggestions.source_link values point to real X posts,
  //    several of which crowd-flagged the media as AI-generated.
  const params = new URLSearchParams({
    "tweet.fields": "attachments,note_request_suggestions,text",
    expansions: "attachments.media_keys",
    max_results: "100",
    test_mode: "true",
  });
  let candidateIds = new Set<string>();
  try {
    const resp = await call(params);
    for (const t of resp.data.data ?? []) {
      candidateIds.add(t.id);
      for (const s of t.note_request_suggestions ?? []) {
        const m = String(s.source_link ?? "").match(/status\/(\d+)/);
        if (m) candidateIds.add(m[1]);
      }
    }
  } catch (err: any) {
    console.log(`[probe] could not gather candidate ids: ${err.response?.status ?? err.message}`);
  }
  const ids = [...candidateIds].slice(0, 90);
  console.log(`[probe] fetching ${ids.length} real tweets for media_metadata inspection`);

  // Swap to Jim's standard Project app for /2/tweets (the prod CN app is not
  // Project-enrolled and 403s on the general v2 tweets endpoint).
  for (const suffix of ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"]) {
    const v = process.env[`X_JIMMAAR1_${suffix}`];
    if (v) process.env[`X_${suffix}`] = v;
  }
  console.log(`[probe] now using X_JIMMAAR1 for /2/tweets ...${process.env.X_API_KEY?.slice(-6)}`);

  // 2) Batch fetch via /2/tweets?ids= (standard endpoint, real data).
  const tParams = new URLSearchParams({
    ids: ids.join(","),
    "tweet.fields": "media_metadata,attachments,text,possibly_sensitive",
    "media.fields": "type,alt_text",
    expansions: "attachments.media_keys",
  });
  const tUrl = `https://api.x.com/2/tweets?${tParams.toString().replace(/\+/g, "%20")}`;
  try {
    const resp = await axios.get(tUrl, {
      headers: { ...getOAuth1Headers(tUrl, "GET"), "Content-Type": "application/json" },
      timeout: 30000,
    });
    const data = resp.data;
    const withMeta = (data.data ?? []).filter((t: any) => t.media_metadata?.length);
    console.log(`[probe] status=${resp.status}; ${data.data?.length ?? 0} returned, ${withMeta.length} have media_metadata`);

    const allEntries: any[] = [];
    for (const t of data.data ?? []) for (const m of t.media_metadata ?? []) allEntries.push(m);
    console.log(`[probe] UNION of keys inside REAL media_metadata entries:`);
    console.log(JSON.stringify(collectKeys(allEntries), null, 2));

    const rich = allEntries.filter((m) => Object.keys(m).length > 1);
    console.log(`[probe] REAL media_metadata entries with >1 key: ${rich.length}`);
    console.log(JSON.stringify(rich.slice(0, 15), null, 2));

    if (data.errors?.length) {
      console.log(`[probe] ${data.errors.length} per-id errors (deleted/protected), e.g.:`);
      console.log(JSON.stringify(data.errors.slice(0, 3), null, 2));
    }
  } catch (err: any) {
    console.log(`[probe] /2/tweets FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
    if (err.response?.data) console.log(JSON.stringify(err.response.data, null, 2));
  }
}

async function main() {
  await dumpFullResponse();
  await probeRealTweetsMediaMetadata();
  await probeCandidateFields();
}

main();
