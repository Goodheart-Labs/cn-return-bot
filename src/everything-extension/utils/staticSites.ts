// The sites whose content scripts are declared in the manifest. Keep this in sync
// with the matches in notes.content.ts and youtube.content.tsx, and with the excludes
// in substack-domain.content.ts. Every other site that has notes gets the generic
// content script registered at runtime by the background's noted-sites sync. A
// Substack newsletter on its own domain gets it from the detector in
// substack-domain.content.ts, whether it has notes or not.
export const STATIC_SITE_HOSTNAME = /(^|\.)substack\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/;
