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
  model: string;
  web_search: "native" | "perplexity" | "searxng" | "searxng_summarized";
  video_description_strategy: VideoDescriptionStrategy;
  scoreFilters: ScoreFilter[];
}

// --- Default config + variants ---

const DEFAULT_CONFIG: BotConfig = {
  model: "anthropic/claude-sonnet-4.6",
  web_search: "perplexity",
  video_description_strategy: "frames",
  scoreFilters: [{ score: "noteNotNeeded", op: "gte", threshold: 0.8 }],
};

interface ConfigVariant {
  name: string;
  weight: number;
  overrides: Partial<BotConfig>;
}

const CONFIG_VARIANTS: ConfigVariant[] = [
  {
    name: "gemini-flash-perplexity",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "perplexity",
    },
  },
  {
    name: "gemini-flash-searxng",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng",
    },
  },
  {
    name: "gemini-flash-searxng-summarized",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng_summarized",
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

export function randomizeConfig(): BotConfig {
  const forced = process.env.FORCE_WEB_SEARCH;
  if (forced) {
    const match = CONFIG_VARIANTS.find((v) => v.overrides.web_search === forced);
    if (!match) throw new Error(`FORCE_WEB_SEARCH=${forced} has no matching CONFIG_VARIANTS entry`);
    return { ...DEFAULT_CONFIG, ...match.overrides };
  }
  const variant = pickVariant(CONFIG_VARIANTS);
  return { ...DEFAULT_CONFIG, ...variant.overrides };
}
