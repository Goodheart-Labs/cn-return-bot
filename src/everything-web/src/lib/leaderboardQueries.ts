import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLeaderboard, fetchMyLeaderboardOptIn, setMyLeaderboardOptIn } from "@cn/core/leaderboard";
import { useSession } from "@cn/features/auth/useSession";
import { queryKeys } from "@cn/features/query/queryKeys";

/** The ranked raters who opted in to being listed. */
export const useLeaderboard = () => useQuery({ queryKey: queryKeys.leaderboard, queryFn: fetchLeaderboard });

/** Whether the signed-in reader is listed on the leaderboard, and the function
 *  that changes it. The box ticks at once, and the ranking reloads once the
 *  choice is saved. */
export function useLeaderboardOptIn() {
  const client = useQueryClient();
  const userId = useSession().session?.user.id;
  const key = queryKeys.leaderboardOptIn(userId);
  const optIn = useQuery({ queryKey: key, queryFn: fetchMyLeaderboardOptIn, enabled: !!userId });
  const change = useMutation({
    mutationFn: (show: boolean) => setMyLeaderboardOptIn(userId!, show),
    onMutate: (show) => client.setQueryData(key, show),
    onError: (_err, show) => client.setQueryData(key, !show),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.leaderboard }),
  });
  return { optIn: optIn.data ?? false, saving: change.isPending, setOptIn: change.mutate };
}
