/**
 * Canonical misinfo topic IDs. Browser-safe (no fs / document loads) so the
 * A/B test registry and the dashboards can import it directly. topics.ts builds
 * the full MisinfoTopic objects (with their documents/briefs) from these IDs.
 *
 * Single source of truth: the `misinfo_topic` A/B test derives a variant per ID
 * from this list, so a forced topic pick can never reference an undeclared
 * variant (which would throw in findVariantByName).
 */

export const MISINFO_TOPIC_IDS = [
  "ai_water",
  "datacenter_land",
  "ai_training_emissions",
  "ai_energy_carbon",
  "openai_dod",
  "save_our_bacon",
  "ea_achievements",
  "trump_election_fraud",
] as const;

export type MisinfoTopicId = (typeof MISINFO_TOPIC_IDS)[number];
