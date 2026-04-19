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
  {
    name: "gemini-flash-perplexity-parallel",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "perplexity",
      parallel_research: true,
    },
  },
  {
    name: "gemini-flash-searxng-parallel",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng",
      parallel_research: true,
    },
  },
  {
    name: "gemini-flash-searxng-summarized-parallel",
    weight: 1,
    overrides: {
      model: "google/gemini-3-flash-preview",
      web_search: "searxng_summarized",
      parallel_research: true,
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
  const forcedSearch = process.env.FORCE_WEB_SEARCH;
  const forcedParallel = process.env.FORCE_PARALLEL_RESEARCH === "1";

  let variant: ConfigVariant;
  if (forcedSearch) {
    const match = CONFIG_VARIANTS.find(
      (v) =>
        v.overrides.web_search === forcedSearch &&
        Boolean(v.overrides.parallel_research) === forcedParallel,
    );
    if (!match) {
      throw new Error(
        `No CONFIG_VARIANTS entry for web_search=${forcedSearch} parallel=${forcedParallel}`,
      );
    }
    variant = match;
  } else {
    variant = pickVariant(CONFIG_VARIANTS);
  }

  return { ...DEFAULT_CONFIG, ...variant.overrides, configName: variant.name };
}
