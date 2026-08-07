// Groups the granular misinfo fact-check topics into the four review "sets"
// Nathan browses by. The DB stores the granular topic (on
// misinfo_monitoring_sightings.topic_id); the *set* is derived here so
// regrouping is a one-line edit, not a data migration.

export type TopicSet = "ai" | "animal-welfare" | "ea" | "politics";

export interface TopicSetInfo {
  id: TopicSet;
  label: string;
  /** Tailwind classes, matching the review-dashboard FilterChip active style. */
  color: string;
}

export const TOPIC_SETS: TopicSetInfo[] = [
  { id: "ai", label: "AI fact-checking", color: "bg-sky-100 text-sky-800" },
  { id: "animal-welfare", label: "Animal welfare", color: "bg-rose-100 text-rose-800" },
  { id: "ea", label: "EA", color: "bg-violet-100 text-violet-800" },
  { id: "politics", label: "Politics / election", color: "bg-amber-100 text-amber-800" },
];

// Granular topic_id (from misinfo_monitoring_sightings) → set. Keep in sync with
// MISINFO_TOPICS in src/pipeline/misinfo-monitoring/topics.ts; an unmapped topic
// simply has no set (shows only under "no topic filter").
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

/** The granular topic ids belonging to any of the given sets — the shape the
 * review dashboard's server-side topic filter takes. */
export function topicIdsForSets(sets: Iterable<string>): string[] {
  const wanted = new Set(sets);
  return Object.entries(TOPIC_TO_SET)
    .filter(([, set]) => wanted.has(set))
    .map(([topicId]) => topicId);
}
