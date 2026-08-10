/** Prioritized authors the auto-enqueue workflow keeps fact-checked. Order is
 *  priority: each run fills its batch from the first feed that has unprocessed
 *  content, then moves down the list. */

export type PriorityFeed =
  | { project: string; type: "substack"; publicationUrl: string }
  | { project: string; type: "youtube"; channelUrl: string };

/** Items enqueued (and thus processed) per run, across all feeds. */
export const BATCH_SIZE = 1;

export const PRIORITY_FEEDS: PriorityFeed[] = [
  { project: "zvi", type: "substack", publicationUrl: "https://thezvi.substack.com" },
  { project: "dwarkesh", type: "youtube", channelUrl: "https://www.youtube.com/@DwarkeshPatel" },
  // Custom-domain publications must use their *.substack.com form — the proxy
  // worker's allowlist only relays those (the redirect to the custom domain is
  // followed transparently).
  { project: "acx", type: "substack", publicationUrl: "https://astralcodexten.substack.com" },
  { project: "natesilver", type: "substack", publicationUrl: "https://natesilver.substack.com" },
  { project: "slowboring", type: "substack", publicationUrl: "https://slowboring.substack.com" },
];
