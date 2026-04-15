import { AsyncLocalStorage } from "node:async_hooks";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface BotConfig {
  model: string;
  provider: "openrouter" | "google";
  web_search: "native" | "perplexity";
  web_fetch: "native" | "custom";
  video_description_strategy: VideoDescriptionStrategy;
}

// --- Default config + variants ---

const DEFAULT_CONFIG: BotConfig = {
  model: "anthropic/claude-sonnet-4.6",
  provider: "openrouter",
  web_search: "native",
  web_fetch: "custom",
  video_description_strategy: "frames",
};

interface ConfigVariant {
  name: string;
  weight: number;
  overrides: Partial<BotConfig>;
}

const CONFIG_VARIANTS: ConfigVariant[] = [
  {
    name: "gemini-3-flash-native",
    weight: 100,
    overrides: {
      model: "gemini-3-flash-preview",
      provider: "google",
      web_search: "native",
      web_fetch: "native",
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

export function usesNativeWebFetch(config: BotConfig): boolean {
  return config.web_fetch === "native" && config.provider === "google";
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
