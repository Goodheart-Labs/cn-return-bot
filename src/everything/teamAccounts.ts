import { getSupabaseClient } from "../api/supabaseClient";

const USERS_PER_PAGE = 1000;

/** The account ids of the team, meaning every account whose email is in
 *  `everything_admins`. Their votes are ours, so they say nothing about what
 *  outside readers think. */
export async function teamVoterIds(): Promise<Set<string>> {
  const db = getSupabaseClient();
  const { data: admins, error } = await db.from("everything_admins").select("email");
  if (error) throw error;
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()));
  const teamIds = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error: usersError } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (usersError) throw usersError;
    for (const user of data.users) if (user.email && adminEmails.has(user.email.toLowerCase())) teamIds.add(user.id);
    if (data.users.length < USERS_PER_PAGE) break;
  }
  return teamIds;
}
