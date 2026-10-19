import { createContext, useContext } from "react";

/* Voting and writing need an account. A reader without one normally gets an
 * invisible anonymous account on the spot. When even that is refused, each
 * surface shows its own sign-in form: the website opens a modal, an extension
 * overlay folds the form in above its notes. The surface provides the opener
 * here, and the shared note components call it without knowing which form it
 * opens. */
const LoginPromptContext = createContext<(() => void) | null>(null);

export const LoginPromptProvider = LoginPromptContext.Provider;

export function useLoginPrompt(): () => void {
  const open = useContext(LoginPromptContext);
  if (!open) throw new Error("useLoginPrompt needs a LoginPromptProvider above it");
  return open;
}
