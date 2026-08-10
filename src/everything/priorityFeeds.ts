/** The authors the auto-enqueue workflow keeps fact-checked. The order of the
 *  list is the priority. Each run fills its batch from the first feed that has
 *  unprocessed content, and only then moves down the list. */

export type PriorityFeed =
  | { project: string; type: "substack"; publicationUrl: string }
  | { project: string; type: "youtube"; channelUrl: string };

/** How many items one run enqueues, and therefore processes, across all feeds. */
export const BATCH_SIZE = 1;

export const PRIORITY_FEEDS: PriorityFeed[] = [
  { project: "zvi", type: "substack", publicationUrl: "https://thezvi.substack.com" },
  { project: "dwarkesh", type: "youtube", channelUrl: "https://www.youtube.com/@DwarkeshPatel" },
  // A publication on a custom domain must be listed by its *.substack.com form.
  // The proxy worker's allowlist only relays that form. The redirect to the
  // custom domain is then followed for us.
  { project: "acx", type: "substack", publicationUrl: "https://astralcodexten.substack.com" },
  { project: "natesilver", type: "substack", publicationUrl: "https://natesilver.substack.com" },
  { project: "slowboring", type: "substack", publicationUrl: "https://slowboring.substack.com" },
];
