import { browser } from "#imports";

// The claims whose note card the reader closed. A helpful note's card opens
// by itself, and a reader who closed it does not want it back on the next
// visit. Claim ids are unique across pages, so no page address is needed.
// Local storage is enough: this is a convenience on one device.
const CLOSED_CLAIMS_KEY = "cn:closedClaims";

/** The list keeps the most recent closes and forgets the oldest ones. */
const CLOSED_CLAIMS_MAX = 500;

async function readClosedClaims(): Promise<string[]> {
  return ((await browser.storage.local.get(CLOSED_CLAIMS_KEY))[CLOSED_CLAIMS_KEY] as string[] | undefined) ?? [];
}

export async function getClosedClaims(): Promise<ReadonlySet<string>> {
  return new Set(await readClosedClaims());
}

export async function rememberClosedClaim(claimId: string): Promise<void> {
  const claims = (await readClosedClaims()).filter((id) => id !== claimId);
  await browser.storage.local.set({ [CLOSED_CLAIMS_KEY]: [...claims, claimId].slice(-CLOSED_CLAIMS_MAX) });
}

export async function forgetClosedClaim(claimId: string): Promise<void> {
  await browser.storage.local.set({ [CLOSED_CLAIMS_KEY]: (await readClosedClaims()).filter((id) => id !== claimId) });
}
