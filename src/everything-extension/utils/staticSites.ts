// Sites injected by the static manifest scripts (keep in sync with
// notes.content.ts / youtube.content.tsx matches). Every OTHER site with
// notes gets the generic content script registered at runtime by the
// background's noted-sites sync.
export const STATIC_SITE_HOSTNAME = /(^|\.)substack\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/;
