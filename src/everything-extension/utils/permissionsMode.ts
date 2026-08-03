// The one switch between the two permission models (imported by BOTH
// wxt.config.ts — it shapes the manifest — and the runtime code):
//
//   true  — <all_urls> is REQUIRED at install; the background silently
//           registers the generic content script for every noted hostname.
//           One big install warning, zero per-site friction.
//   false — <all_urls> stays OPTIONAL; navigating to a noted site without
//           the grant redirects through grant.html, which asks and requests
//           just that origin. Store-review-friendly; per-site consent.
//
// Pure constant module: no browser imports, so the build config can load it.
export const ASSUME_ALL_URLS = false;
