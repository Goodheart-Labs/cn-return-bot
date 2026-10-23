import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";

/** What every list shows when the server could not be reached: what failed,
 *  why, and a button that tries again. `what` names the thing, such as "These
 *  notes". */
export function LoadFailed({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-sm text-fg-secondary">{what} could not be loaded. The connection to our server failed.</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
