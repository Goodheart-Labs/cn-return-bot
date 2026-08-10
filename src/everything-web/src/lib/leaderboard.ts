import { supabase } from "../../../everything-shared/supabase";

/** One ranked rater. It holds a public display name and how many notes that
 *  person has rated. */
export type LeaderboardEntry = { name: string; rating_count: number };

/** The ranked raters, fetched through a security-definer RPC. Only users who
 *  opted in appear. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("everything_leaderboard");
  if (error) throw error;
  return (data ?? []) as LeaderboardEntry[];
}

/** Whether the caller currently shows on the leaderboard. Someone with no
 *  preferences row yet is hidden. */
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
