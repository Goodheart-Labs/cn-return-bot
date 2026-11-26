import { browser } from "#imports";

// The generic notes content script is registered once per noted hostname. The
// background's sync registers it when <all_urls> is required at install. The
// grant page registers it in redirect mode. The popup registers it when the
// user enables the site from there.
export const GENERIC_SCRIPT_PREFIX = "cn-generic-";

/** The custom-domain Substack detector (entrypoints/substack-domain.content.ts)
 *  sends this when the page it runs on is a Substack publication. */
export const SUBSTACK_DOMAIN_MESSAGE_TYPE = "cn-substack-domain";

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
