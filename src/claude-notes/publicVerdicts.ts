/* Which notes outside readers have settled on, for the writer's examples.
 * The public decides what is Helpful, so its clearest verdicts go in the
 * prompt beside Jim's and Nathan's. */

/** The site's crowd bar, used both ways: at least this many votes one way,
 *  and over twice the votes the other way. */
export const MIN_PUBLIC_VOTES = 3;
/** The most-voted Helpful notes the examples show, so the prompt grows by a bounded amount. */
export const MAX_PUBLIC_HELPFUL = 40;

export interface PublicVerdict {
  noteId: string;
  verdict: "Helpful" | "Not helpful";
  helpful: number;
  notHelpful: number;
}

/** The notes readers outside the team rated clearly Helpful or clearly Not
 *  helpful. Not helpful first, because those are the clearest lessons; each
 *  group most-voted first. Team votes and Somewhat helpful votes are left out. */
export function publicVerdicts(votes: { note_id: string; voter_id: string; vote: number }[], teamIds: Set<string>): PublicVerdict[] {
  const counts = new Map<string, { helpful: number; notHelpful: number }>();
  for (const v of votes) {
    if (teamIds.has(v.voter_id) || v.vote === 0) continue;
    const c = counts.get(v.note_id) ?? { helpful: 0, notHelpful: 0 };
    if (v.vote > 0) c.helpful++;
    else c.notHelpful++;
    counts.set(v.note_id, c);
  }
  const all = [...counts].map(([noteId, c]) => ({ noteId, ...c }));
  const clear = (mine: number, theirs: number) => mine >= MIN_PUBLIC_VOTES && mine > 2 * theirs;
  const bad = all.filter((c) => clear(c.notHelpful, c.helpful)).sort((a, b) => b.notHelpful - a.notHelpful);
  const good = all.filter((c) => clear(c.helpful, c.notHelpful)).sort((a, b) => b.helpful - a.helpful);
  return [...bad.map((c) => ({ ...c, verdict: "Not helpful" as const })), ...good.map((c) => ({ ...c, verdict: "Helpful" as const }))];
}
