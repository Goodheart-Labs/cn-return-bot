// The sites whose content scripts are declared in the manifest. Keep this in sync
// with the matches in notes.content.ts and youtube.content.tsx. Every other site that
// has notes gets the generic content script registered at runtime by the background's
// noted-sites sync.
export const STATIC_SITE_HOSTNAME = /(^|\.)substack\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/;
