/** One daily site check (GOO-804). Each check exercises one piece of our code
 *  that depends on how Substack, YouTube or the forums build their pages or
 *  API answers, against the live site. Such code tends to fail silently: when
 *  the site changes, a reader returns nothing instead of throwing. For a month
 *  in autumn 2026 the extension could not tell that a newsletter on its own
 *  domain was on Substack, and nothing went red (GOO-774). */
export interface SiteCheck {
  site: "Substack" | "YouTube" | "Forums" | "Page reader";
  /** What still works when the check passes, in plain words. */
  name: string;
  /** The code the check exercises, so a failure says where to look. */
  code: string;
  /** Resolves with a short description of what the site answered, and
   *  throws with what was wrong. */
  run: () => Promise<string>;
}

/** Throws `message` when `condition` is false. */
export function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Thrown when a check cannot run from the devbox at all, as opposed to
 *  failing. YouTube, for one, refuses to play videos to datacenter
 *  addresses. The report lists such checks apart, with the reason. */
export class CannotRunError extends Error {}
