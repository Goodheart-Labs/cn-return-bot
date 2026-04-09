import { AsyncLocalStorage } from "node:async_hooks";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface BotConfig {
  model: string;
  search_mode: "native-search" | "perplexity-search";
  video_description_strategy: VideoDescriptionStrategy;
}

// --- Default config + variants ---

const DEFAULT_CONFIG: BotConfig = {
  model: "anthropic/claude-sonnet-4.6",
  search_mode: "native-search",
  video_description_strategy: "frames",
};

interface ConfigVariant {
  name: string;
  weight: number;
  overrides: Partial<BotConfig>;
}

const CONFIG_VARIANTS: ConfigVariant[] = [
  {
    name: "gemini-3-flash-perplexity",
    weight: 100,
    overrides: { model: "google/gemini-3-flash-preview", search_mode: "perplexity-search" },
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
  const variant = pickVariant(CONFIG_VARIANTS);
  return { ...DEFAULT_CONFIG, ...variant.overrides };
}

