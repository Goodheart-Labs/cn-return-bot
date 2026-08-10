// The single switch between our two permission models. Both wxt.config.ts and the
// runtime code import it, so it shapes the manifest as well as the behaviour.
//
// When it is true, access to all URLs is required at install time. The background
// then registers the generic content script for every hostname that has notes,
// without asking. The user sees one broad install warning and no further prompts.
//
// When it is false, access to all URLs stays optional. Navigating to a site that has
// notes but no grant yet detours through grant.html, which asks the user and then
// requests that one origin. This model is easier to get through store review and
// lets the user consent one site at a time.
//
// This module holds nothing but the constant. It imports no browser APIs, so the
// build config can load it.
export const ASSUME_ALL_URLS = false;
