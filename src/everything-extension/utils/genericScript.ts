import { browser } from "#imports";

// The generic notes content script, registered per noted hostname — by the
// background's sync (all-urls mode), the grant page (redirect mode), or the
// popup's direct-inject fallback.
export const GENERIC_SCRIPT_PREFIX = "cn-generic-";

export const genericScriptId = (hostname: string) => `${GENERIC_SCRIPT_PREFIX}${hostname}`;
export const hostnamePattern = (hostname: string) => `*://${hostname}/*`;

export async function registerGenericScripts(hostnames: string[]): Promise<void> {
  await browser.scripting.registerContentScripts(hostnames.map((hostname) => ({
    id: genericScriptId(hostname),
    matches: [hostnamePattern(hostname)],
    js: ["/content-scripts/generic.js"],
    runAt: "document_idle" as const,
    persistAcrossSessions: true,
  })));
}
