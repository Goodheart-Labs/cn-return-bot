/** Prioritized authors the auto-enqueue workflow keeps fact-checked. Order is
 *  priority: each run fills its batch from the first feed that has unprocessed
 *  content, then moves down the list. */

export type PriorityFeed =
  | { project: string; type: "substack"; profileUrl: string }
  | { project: string; type: "youtube"; channelUrl: string };

/** Items enqueued (and thus processed) per run, across all feeds. */
export const BATCH_SIZE = 2;

/** Channel videos shorter than this are trailers/announcements, not episodes. */
export const MIN_VIDEO_SECONDS = 5 * 60;

export const PRIORITY_FEEDS: PriorityFeed[] = [
  { project: "zvi", type: "substack", profileUrl: "https://substack.com/@thezvi" },
  { project: "dwarkesh", type: "youtube", channelUrl: "https://www.youtube.com/@DwarkeshPatel" },
];
