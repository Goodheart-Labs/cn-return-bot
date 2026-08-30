/**
 * The canonical misinfo topic IDs. This file is safe to import in a browser
 * because it reads nothing from disk, so the A/B test registry and the
 * dashboards can import it directly. topics.ts turns these IDs into the full
 * MisinfoTopic objects, with their documents and their briefs.
 *
 * This list is the single source of truth. The `misinfo_topic` A/B test derives
 * one variant per ID from it. A forced topic pick can therefore never name a
 * variant that was never declared, which findVariantByName would throw on.
 */

export const MISINFO_TOPIC_IDS = [
  "ai_water",
  "datacenter_land",
  "ai_training_emissions",
  "ai_energy_carbon",
  "openai_dod",
  "save_our_bacon",
  "ea_achievements",
  "trump_election_security",
  "trump_election_fraud",
] as const;

export type MisinfoTopicId = (typeof MISINFO_TOPIC_IDS)[number];

/**
 * The topics enrolled in the concede-then-correct experiment. The
 * misinfo_concede_shape A/B test samples a pick only on these topics, through
 * its prerequisite on the misinfo_topic config field. Enrolling a topic means
 * adding its ID here and wrapping the experiment's additions in its document
 * in concede-shape marker lines. topics.ts throws at load time when an
 * enrolled topic's document carries no marked content.
 */
export const CONCEDE_SHAPE_TOPIC_IDS: MisinfoTopicId[] = ["trump_election_security"];
