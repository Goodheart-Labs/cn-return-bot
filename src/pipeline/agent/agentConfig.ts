import { AsyncLocalStorage } from "node:async_hooks";

// --- Feature flag definitions ---

interface FlagOption<T> {
  value: T;
  weight: number;
}

interface FeatureFlag {
  name: string;
  options: FlagOption<string | number | boolean>[];
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    name: "search_mode",
    options: [
      { value: "native-search", weight: 50 },
      { value: "perplexity-search", weight: 50 },
    ],
  },
];

// --- Config type ---

export interface BotConfig {
  search_mode: "native-search" | "perplexity-search";
  [key: string]: string | number | boolean;
}

// --- AsyncLocalStorage ---

const configStorage = new AsyncLocalStorage<BotConfig>();

export function withBotConfig<T>(config: BotConfig, fn: () => T): T {
  return configStorage.run(config, fn);
}

// --- Randomization ---

function pickWeighted<T>(options: FlagOption<T>[]): T {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.value;
  }
  return options[options.length - 1]!.value;
}

export function randomizeConfig(): BotConfig {
  const config: Record<string, string | number | boolean> = {};
  for (const flag of FEATURE_FLAGS) {
    config[flag.name] = pickWeighted(flag.options);
  }
  return config as BotConfig;
}

// --- Bot name derivation ---

export function deriveBotName(base: string, config: BotConfig): string {
  const flagValues = FEATURE_FLAGS.map((f) => String(config[f.name]));
  return [base, ...flagValues].join("_");
}
