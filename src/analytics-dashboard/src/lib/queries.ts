import { supabase } from "../../../everything-shared/supabase";

// Both queries run through security-definer RPCs (migration 077) — the anon
// key cannot read everything_events or everything_votes directly, and the
// RPCs return only aggregate counts.

export type FunnelStage =
  | "visitors"
  | "installs"
  | "shown_notes"
  | "signed_in"
  | "voted_1"
  | "voted_5"
  | "voted_10";

export interface FunnelRow {
  platform: string;
  stage: FunnelStage;
  users: number;
}

export interface DailyRow {
  day: string;
  platform: string;
  event: string;
  events: number;
}

export interface TimeWindow {
  label: string;
  days: number | null;
}

export const WINDOWS: readonly TimeWindow[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All time", days: null },
];

export async function fetchFunnel(days: number | null): Promise<FunnelRow[]> {
  const { data, error } = await supabase.rpc("everything_funnel", { window_days: days });
  if (error) throw new Error(`everything_funnel failed: ${error.message}`);
  return data as FunnelRow[];
}

export async function fetchDaily(days: number | null): Promise<DailyRow[]> {
  const { data, error } = await supabase.rpc("everything_daily_activity", { window_days: days });
  if (error) throw new Error(`everything_daily_activity failed: ${error.message}`);
  return data as DailyRow[];
}
