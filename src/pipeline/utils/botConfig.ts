import { AsyncLocalStorage } from "node:async_hooks";
import type { AllNoteScores } from "../score/noteScores";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface ScoreFilter {
  score: keyof AllNoteScores;
  op: "gte" | "lte";
  threshold: number;
}

export interface BotConfig {
  configName: string;
  model: string;
  /** Step-specific model overrides. Each defaults to `model` when unset. */
  search_model?: string;
  writer_model?: string;
  verifier_model?: string;
  web_search: "native" | "perplexity" | "searxng" | "searxng_summarized";
  video_description_strategy: VideoDescriptionStrategy;
  scoreFilters: ScoreFilter[];
  parallel_research: boolean;
}

// --- Default config + variants ---

const DEFAULT_CONFIG: BotConfig = {
  configName: "default",
  model: "anthropic/claude-sonnet-4.6",
  web_search: "perplexity",
  video_description_strategy: "frames",
  scoreFilters: [],
  parallel_research: false,
};

interface ConfigVariant {
  name: string;
  weight: number;
  botIds: string[];
  overrides: Partial<BotConfig>;
}

const AGENT_FAMILY_BOT_IDS = ["agent", "multi-agent"];

const CONFIG_VARIANTS: ConfigVariant[] = [
  {
    name: "gemini-flash-perplexity",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "perplexity",
    },
  },
  {
    name: "gemini-flash-searxng",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng",
    },
  },
  {
    name: "gemini-flash-searxng-summarized",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng_summarized",
    },
  },
  {
    name: "gemini-flash-perplexity-parallel",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "perplexity",
      parallel_research: true,
    },
  },
  {
    name: "gemini-flash-searxng-parallel",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng",
      parallel_research: true,
    },
  },
  {
    name: "gemini-flash-searxng-summarized-parallel",
    weight: 1,
    botIds: AGENT_FAMILY_BOT_IDS,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng_summarized",
      parallel_research: true,
    },
  },
  {
    name: "claude-simple-sonnet-sonnet",
    weight: 1,
    botIds: ["claude-simple"],
    overrides: {
      model: "anthropic/claude-sonnet-4.6",
      search_model: "anthropic/claude-sonnet-4.6",
      writer_model: "anthropic/claude-sonnet-4.6",
      verifier_model: "google/gemini-3-flash-preview",
      web_search: "native",
    },
  },
  {
    name: "claude-simple-sonnet-gemini",
    weight: 1,
    botIds: ["claude-simple"],
    overrides: {
      model: "anthropic/claude-sonnet-4.6",
      search_model: "anthropic/claude-sonnet-4.6",
      writer_model: "google/gemini-3-flash-preview",
      verifier_model: "google/gemini-3-flash-preview",
      web_search: "native",
    },
  },
];

// --- AsyncLocalStorage ---

const configStorage = new AsyncLocalStorage<BotConfig>();

export function withBotConfig<T>(config: BotConfig, fn: () => T): T {
  return configStorage.run(config, fn);
}

export function getBotConfig(): BotConfig {
  const config = configStorage.getStore();
  if (!config) throw new Error("getBotConfig() called outside withBotConfig()");
  return config;
}

// --- Config overrides (force a specific variant at the pipeline entry point) ---

export interface ConfigOverrides {
  configName?: string;
}

const overridesStorage = new AsyncLocalStorage<ConfigOverrides>();

export function withConfigOverrides<T>(overrides: ConfigOverrides, fn: () => T): T {
  return overridesStorage.run(overrides, fn);
}

function getConfigOverrides(): ConfigOverrides {
  return overridesStorage.getStore() ?? {};
}

export function getConfigVariantNames(): string[] {
  return CONFIG_VARIANTS.map((v) => v.name);
}

// --- Randomization ---

function pickVariant(variants: ConfigVariant[]): ConfigVariant {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of variants) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return variants[variants.length - 1]!;
}

export function getFullBotId(botId: string, config: BotConfig): string {
  return `${botId}_${config.configName}`;
}

export function randomizeConfig(botId: string): BotConfig {
  const { configName: forcedName } = getConfigOverrides();

  let variant: ConfigVariant;
  if (forcedName) {
    const match = CONFIG_VARIANTS.find((v) => v.name === forcedName);
    if (!match) {
      throw new Error(
        `No CONFIG_VARIANTS entry named "${forcedName}". Available: ${getConfigVariantNames().join(", ")}`,
      );
    }
    if (!match.botIds.includes(botId)) {
      throw new Error(
        `Config variant "${forcedName}" is not allowed for bot "${botId}". Allowed bots: ${match.botIds.join(", ")}`,
      );
    }
    variant = match;
  } else {
    const pool = CONFIG_VARIANTS.filter((v) => v.botIds.includes(botId));
    if (pool.length === 0) {
      throw new Error(`No config variants available for bot "${botId}"`);
    }
    variant = pickVariant(pool);
  }

  return { ...DEFAULT_CONFIG, ...variant.overrides, configName: variant.name };
}
