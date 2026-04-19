/**
 * Capture prod Supabase creds at import time, before any local-remap happens.
 *
 * Both tryoutNotes.ts and runOnVideos.ts remap SUPABASE_URL/SUPABASE_SERVICE_KEY
 * to their LOCAL_* equivalents near the top of the file. The dashboard, however,
 * lives on prod — so the auto-open flow needs the original prod values.
 *
 * Import this module BEFORE the remap lines to capture the prod creds.
 */

export const PROD_SUPABASE_URL = process.env.SUPABASE_URL;
export const PROD_SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
