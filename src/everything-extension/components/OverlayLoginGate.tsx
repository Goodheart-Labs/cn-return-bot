import type { ReactNode } from "react";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { useSession } from "@cn/features/auth/useSession";
import { LoginPanel } from "./LoginPanel";

/** Gives the notes inside an overlay a sign-in form of their own. When a
 *  reader who cannot get an anonymous account tries to vote or write, the form
 *  folds in above the notes, and it goes away once they are signed in. The
 *  overlay owns `open`, because the YouTube card stays up while it is open. */
export function OverlayLoginGate({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { session } = useSession();
  return (
    <LoginPromptProvider value={() => onOpenChange(true)}>
      {open && !session && (
        <div className="mb-3 pb-3 border-b border-line">
          <LoginPanel surface="overlay" onDismiss={() => onOpenChange(false)} />
        </div>
      )}
      {children}
    </LoginPromptProvider>
  );
}
