import type { SupabaseLogger } from "../../api/supabaseClient";

const STATE_KEY = "writing_limit";

async function readWritingLimit(logger: SupabaseLogger): Promise<number | null> {
  const raw = await logger.getPipelineState(STATE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Keep the display estimate growing after success; database admission owns retries. */
export async function bumpWritingLimitFromSuccess(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(24);
  const estimate = count + 1;
  const current = await readWritingLimit(logger);
  if (current !== null && current >= estimate) return;
  await logger.setPipelineState(STATE_KEY, String(estimate));
  console.log(`[writing-limit] Submission succeeded → writing_limit=${estimate} (was ${current ?? "unset"})`);
}
