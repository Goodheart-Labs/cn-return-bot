import { useState } from "react";
import { Button } from "@cn/ui/Button";

type ActionPhase = "idle" | "busy" | "done" | "error";

/** One action button: the label, the confirmation text once it ran, and what
 *  it does. `alreadyDone` starts true when the action has already been taken,
 *  so the popup shows the confirmation instead of the button. */
export interface StatusAction {
  label: string;
  doneLabel: string;
  alreadyDone: boolean;
  run: () => Promise<void>;
}

export function ActionButton({ action }: { action: StatusAction }) {
  const [phase, setPhase] = useState<ActionPhase>(action.alreadyDone ? "done" : "idle");

  const run = async () => {
    setPhase("busy");
    try {
      await action.run();
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") return <p className="text-sm text-positive">{action.doneLabel}</p>;
  return (
    <div>
      <Button className="w-full" onClick={run} disabled={phase === "busy"}>
        {action.label}
      </Button>
      {phase === "error" && <p className="mt-2 text-sm text-negative">Something went wrong. Try again</p>}
    </div>
  );
}
