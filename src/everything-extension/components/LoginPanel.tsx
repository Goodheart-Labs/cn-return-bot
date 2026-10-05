import { browser } from "#imports";
import type { EmailFlow } from "@cn/core/auth";
import { SignInForm, type PendingEmailStore } from "@cn/features/auth/SignInForm";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon } from "@cn/ui/icons";

// The login form closes when the user switches away to their mail client to
// fetch the code. The popup unmounts entirely, and an overlay can get
// dismissed. That wipes all React state. So the email we are waiting on a code
// for is kept in chrome.storage.local, and whichever login panel opens next,
// in the popup or inside an overlay, lands back on the code input. It has to
// be storage.local, because content scripts cannot read storage.session
// without a lowered access level. A stored email older than an hour is
// ignored, so an abandoned login cannot resurface days later.
const PENDING_EMAIL_KEY = "cn-login-pending-email";
const PENDING_EMAIL_MAX_AGE_MS = 60 * 60 * 1000;

type PendingEmail = { email: string; at: number; flow?: EmailFlow };

const pendingEmailStore: PendingEmailStore = {
  async load() {
    const stored = (await browser.storage.local.get(PENDING_EMAIL_KEY))[PENDING_EMAIL_KEY] as PendingEmail | undefined;
    if (!stored?.email || Date.now() - stored.at > PENDING_EMAIL_MAX_AGE_MS) return null;
    return { email: stored.email, flow: stored.flow ?? "signin" };
  },
  save: (email, flow) => browser.storage.local.set({ [PENDING_EMAIL_KEY]: { email, at: Date.now(), flow } satisfies PendingEmail }),
  clear: () => browser.storage.local.remove(PENDING_EMAIL_KEY),
};

/** X sign-in runs launchWebAuthFlow in the background script, so the session
 *  ends up in chrome.storage.local and reaches every other context through
 *  the session store's storage listener. Safari has no launchWebAuthFlow, so
 *  the Safari build offers the email code only. */
async function signInWithX(): Promise<{ error?: string }> {
  const result = (await browser.runtime.sendMessage({ type: "cn-signin-x" })) as { ok: boolean; error?: string } | undefined;
  return result?.ok ? {} : { error: result?.error ?? "X sign-in failed" };
}

/** The extension's sign-in. The settings page renders it, and so do the note
 *  overlays when a signed-out reader tries to vote or write, so nobody is sent
 *  off to the toolbar icon. `surface` says which of them hosted the sign-in,
 *  for the funnel. `onDismiss` adds a close button; the settings page leaves it
 *  out because its form has nowhere to go. */
export function LoginPanel({ surface = "settings", onDismiss }: { surface?: "settings" | "overlay"; onDismiss?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-secondary">Sign in to keep your votes and notes across devices</p>
        {onDismiss && <IconButton label="Not now" onClick={onDismiss}><CloseIcon size={14} aria-hidden /></IconButton>}
      </div>
      <SignInForm surface={surface} signInWithX={import.meta.env.SAFARI ? undefined : signInWithX} pendingEmail={pendingEmailStore} />
    </div>
  );
}
