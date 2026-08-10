// Groups the fine-grained misinformation fact-check topics into the four review
// sets Nathan browses by. The database only stores the fine-grained topic, in
// misinfo_monitoring_sightings.topic_id. The set is worked out here instead, so
// regrouping the topics is a one-line edit rather than a data migration.

export type TopicSet = "ai" | "animal-welfare" | "ea" | "politics";

export interface TopicSetInfo {
  id: TopicSet;
  label: string;
  /** Tailwind classes for the chip. They match the active style of the review
   *  dashboard's FilterChip. */
  color: string;
}

export const TOPIC_SETS: TopicSetInfo[] = [
  { id: "ai", label: "AI fact-checking", color: "bg-sky-100 text-sky-800" },
  { id: "animal-welfare", label: "Animal welfare", color: "bg-rose-100 text-rose-800" },
  { id: "ea", label: "EA", color: "bg-violet-100 text-violet-800" },
  { id: "politics", label: "Politics / election", color: "bg-amber-100 text-amber-800" },
];

// Maps a fine-grained topic_id from misinfo_monitoring_sightings onto its set.
// Keep this in sync with MISINFO_TOPICS in
// src/pipeline/misinfo-monitoring/topics.ts. A topic that is missing here has no
// set, so it only shows up when no topic filter is applied.
const TOPIC_TO_SET: Record<string, TopicSet> = {
  ai_water: "ai",
  datacenter_land: "ai",
  ai_training_emissions: "ai",
  ai_energy_carbon: "ai",
  openai_dod: "ai",
  save_our_bacon: "animal-welfare",
  ea_achievements: "ea",
  // Both the historical and the live Trump topic ids map to politics.
  trump_election_fraud: "politics",
  trump_election_security: "politics",
};

export function topicSetFor(topicId: string | null | undefined): TopicSet | undefined {
  if (!topicId) return undefined;
  return TOPIC_TO_SET[topicId];
}

/** Returns the fine-grained topic ids that belong to any of the given sets. The
 *  review dashboard's topic filter runs on the server, and this is the shape it
 *  takes its topics in. */
export function topicIdsForSets(sets: Iterable<string>): string[] {
  const wanted = new Set(sets);
  return Object.entries(TOPIC_TO_SET)
    .filter(([, set]) => wanted.has(set))
    .map(([topicId]) => topicId);
}
