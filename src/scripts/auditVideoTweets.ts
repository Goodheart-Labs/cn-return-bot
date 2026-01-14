/**
 * Audit Video Tweets
 *
 * Fetches eligible posts and analyzes media composition to understand
 * what percentage of tweets contain videos vs photos vs text-only.
 *
 * Usage:
 *   bun run src/scripts/auditVideoTweets.ts [maxPosts] [maxPages]
 *   bun run src/scripts/auditVideoTweets.ts --sample  # Use sample data (no API needed)
 */

import samplePosts from "../pipeline/posts.json";

// Inline type to avoid import chain issues
type Post = {
  id: string;
  author_id: string;
  created_at: string;
  text: string;
  media: Array<{
    media_key?: string;
    type: string;
    url?: string;
    preview_image_url?: string;
    duration_ms?: number;
    view_count?: number;
  }>;
};

interface MediaStats {
  total: number;
  withVideo: number;
  withPhotoOnly: number;
  textOnly: number;
  withMixedMedia: number;
  videoDetails: {
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    avgViewCount: number;
  };
}

function analyzePosts(posts: Post[]): MediaStats {
  const stats: MediaStats = {
    total: posts.length,
    withVideo: 0,
    withPhotoOnly: 0,
    textOnly: 0,
    withMixedMedia: 0,
    videoDetails: {
      avgDurationMs: 0,
      minDurationMs: Infinity,
      maxDurationMs: 0,
      avgViewCount: 0,
    },
  };

  const videoDurations: number[] = [];
  const videoViewCounts: number[] = [];
  const videoPosts: Array<{ id: string; text: string; duration: number }> = [];

  for (const post of posts) {
    const hasVideo = post.media?.some((m) => m.type === "video");
    const hasPhoto = post.media?.some((m) => m.type === "photo");
    const hasAnimatedGif = post.media?.some((m) => m.type === "animated_gif");

    if (!post.media || post.media.length === 0) {
      stats.textOnly++;
    } else if (hasVideo && hasPhoto) {
      stats.withMixedMedia++;
      stats.withVideo++; // Count mixed as video too
    } else if (hasVideo || hasAnimatedGif) {
      stats.withVideo++;
    } else if (hasPhoto) {
      stats.withPhotoOnly++;
    }

    // Collect video stats
    for (const media of post.media || []) {
      if (media.type === "video") {
        if (media.duration_ms) {
          videoDurations.push(media.duration_ms);
          stats.videoDetails.minDurationMs = Math.min(
            stats.videoDetails.minDurationMs,
            media.duration_ms
          );
          stats.videoDetails.maxDurationMs = Math.max(
            stats.videoDetails.maxDurationMs,
            media.duration_ms
          );
        }
        if (media.view_count) {
          videoViewCounts.push(media.view_count);
        }
        videoPosts.push({
          id: post.id,
          text: post.text.slice(0, 80) + (post.text.length > 80 ? "..." : ""),
          duration: media.duration_ms || 0,
        });
      }
    }
  }

  // Calculate averages
  if (videoDurations.length > 0) {
    stats.videoDetails.avgDurationMs =
      videoDurations.reduce((a, b) => a + b, 0) / videoDurations.length;
  }
  if (videoViewCounts.length > 0) {
    stats.videoDetails.avgViewCount =
      videoViewCounts.reduce((a, b) => a + b, 0) / videoViewCounts.length;
  }
  if (stats.videoDetails.minDurationMs === Infinity) {
    stats.videoDetails.minDurationMs = 0;
  }

  // Print results
  console.log("=".repeat(60));
  console.log("VIDEO TWEET AUDIT RESULTS");
  console.log("=".repeat(60));
  console.log(`\nTotal posts analyzed: ${stats.total}\n`);

  console.log("MEDIA BREAKDOWN:");
  console.log("-".repeat(40));
  const pct = (n: number) => ((n / stats.total) * 100).toFixed(1);
  console.log(`  Videos:      ${stats.withVideo.toString().padStart(4)} (${pct(stats.withVideo)}%)`);
  console.log(`  Photos only: ${stats.withPhotoOnly.toString().padStart(4)} (${pct(stats.withPhotoOnly)}%)`);
  console.log(`  Text only:   ${stats.textOnly.toString().padStart(4)} (${pct(stats.textOnly)}%)`);
  console.log(`  Mixed media: ${stats.withMixedMedia.toString().padStart(4)} (${pct(stats.withMixedMedia)}%)`);

  if (videoDurations.length > 0) {
    console.log("\nVIDEO DETAILS:");
    console.log("-".repeat(40));
    console.log(`  Avg duration:  ${(stats.videoDetails.avgDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Min duration:  ${(stats.videoDetails.minDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Max duration:  ${(stats.videoDetails.maxDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Avg views:     ${Math.round(stats.videoDetails.avgViewCount).toLocaleString()}`);

    // Estimate costs
    const totalVideoMinutes = videoDurations.reduce((a, b) => a + b, 0) / 60000;
    const whisperCost = totalVideoMinutes * 0.006;
    const keyframeCost = videoDurations.length * 0.01;
    const hybridCost = whisperCost + keyframeCost;

    console.log("\nESTIMATED COSTS (for this batch):");
    console.log("-".repeat(40));
    console.log(`  Audio transcription: $${whisperCost.toFixed(3)} (${totalVideoMinutes.toFixed(1)} min total)`);
    console.log(`  Keyframe analysis:   $${keyframeCost.toFixed(3)} (${videoDurations.length} videos)`);
    console.log(`  Hybrid total:        $${hybridCost.toFixed(3)}`);
    console.log(`  Per video avg:       $${(hybridCost / videoDurations.length).toFixed(4)}`);
  }

  if (videoPosts.length > 0) {
    console.log("\nSAMPLE VIDEO POSTS:");
    console.log("-".repeat(40));
    for (const vp of videoPosts.slice(0, 5)) {
      console.log(`  [${vp.id}] (${(vp.duration / 1000).toFixed(0)}s) ${vp.text}`);
    }
    if (videoPosts.length > 5) {
      console.log(`  ... and ${videoPosts.length - 5} more`);
    }
  }

  console.log("\n" + "=".repeat(60));

  return stats;
}

async function auditFromApi(maxPosts: number, maxPages: number) {
  // Dynamic import to avoid loading deps when using --sample
  const { fetchEligiblePosts } = await import("../api/fetchEligiblePosts");

  console.log(`[audit] Fetching up to ${maxPosts} eligible posts across ${maxPages} pages...\n`);
  const posts = await fetchEligiblePosts(maxPosts, new Set(), maxPages);
  return analyzePosts(posts);
}

function auditFromSample() {
  console.log(`[audit] Using sample data (${samplePosts.length} posts)...\n`);
  return analyzePosts(samplePosts as Post[]);
}

// Main
const useSample = process.argv.includes("--sample");

if (useSample) {
  auditFromSample();
} else {
  const maxPosts = parseInt(process.argv[2] || "100", 10);
  const maxPages = parseInt(process.argv[3] || "10", 10);

  auditFromApi(maxPosts, maxPages)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Audit failed:", err);
      console.log("\nTip: Run with --sample to use sample data without API access");
      process.exit(1);
    });
}
