import { supabase } from "./supabase";

/** One ranked rater: a public display name + how many notes they've rated. */
export type LeaderboardEntry = { name: string; rating_count: number };

/** Ranked raters (opted-in users only), via the security-definer RPC. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("everything_leaderboard");
  if (error) throw error;
  return (data ?? []) as LeaderboardEntry[];
}

/** The caller's own leaderboard visibility (no prefs row yet = hidden). */
export async function fetchMyLeaderboardOptIn(): Promise<boolean> {
  const { data } = await supabase
    .from("everything_rater_prefs")
    .select("show_on_leaderboard")
    .maybeSingle();
  return data?.show_on_leaderboard ?? false;
}

/** Set the caller's leaderboard visibility. */
export async function setMyLeaderboardOptIn(userId: string, show: boolean): Promise<void> {
  const { error } = await supabase
    .from("everything_rater_prefs")
    .upsert(
      { user_id: userId, show_on_leaderboard: show, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}
