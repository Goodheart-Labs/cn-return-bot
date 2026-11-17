import { cn } from "@cn/ui/cn";
import { LoadFailed } from "./LoadFailed";
import type { PagedList } from "./usePagedList";

/** What sits below the last entry of a paged list: the element that loads the
 *  next page when it nears the screen, a line while that page loads, and a way
 *  to try again when it failed. After the last page it shows `endText`, if
 *  given. */
export function PagedListEnd({ list, endText, className }: { list: PagedList<unknown>; endText?: string; className?: string }) {
  const { moreFailed, hasMore, loadingMore, retry, sentinel } = list;
  if (moreFailed) return <LoadFailed what="The next part of this list" onRetry={retry} className={className} />;
  if (!hasMore) return endText ? <p className={cn("text-center text-xs text-fg-muted", className)}>{endText}</p> : null;
  return (
    <div ref={sentinel} className={cn("text-sm text-fg-muted", className)}>
      {loadingMore ? "Loading more…" : null}
    </div>
  );
}
