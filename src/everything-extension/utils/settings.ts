import { browser } from "#imports";

// Origins the user has opted into beyond the static Substack/YouTube matches.
const ENABLED_ORIGINS_KEY = "cn:enabledOrigins";

export async function getEnabledOrigins(): Promise<string[]> {
  return ((await browser.storage.sync.get(ENABLED_ORIGINS_KEY))[ENABLED_ORIGINS_KEY] as string[] | undefined) ?? [];
}

export async function updateEnabledOrigins(mutate: (origins: string[]) => string[]): Promise<void> {
  await browser.storage.sync.set({ [ENABLED_ORIGINS_KEY]: mutate(await getEnabledOrigins()) });
}

export function onEnabledOriginsChanged(callback: () => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[ENABLED_ORIGINS_KEY]) callback();
  });
}
