import { useEffect, useState } from "react";
import { browser } from "#imports";
import { BUTTON, INPUT, QUIET_LINK, SECONDARY_BUTTON } from "../../everything-shared/ui";
import { IconButton } from "../../everything-web/src/components/IconButton";
import { EMAIL_OTP_LENGTH, signInWithEmailCode, verifyEmailCode, type EmailFlow } from "../../everything-shared/auth";
import { track } from "../../everything-shared/analytics";

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

async function getPendingEmail(): Promise<{ email: string; flow: EmailFlow } | null> {
  const stored = (await browser.storage.local.get(PENDING_EMAIL_KEY))[PENDING_EMAIL_KEY] as PendingEmail | undefined;
  if (!stored?.email || Date.now() - stored.at > PENDING_EMAIL_MAX_AGE_MS) return null;
  return { email: stored.email, flow: stored.flow ?? "signin" };
}

const setPendingEmail = (email: string, flow: EmailFlow) =>
  browser.storage.local.set({ [PENDING_EMAIL_KEY]: { email, at: Date.now(), flow } satisfies PendingEmail });

const clearPendingEmail = () => browser.storage.local.remove(PENDING_EMAIL_KEY);

const FIELD = `flex-1 min-w-0 ${INPUT}`;

/** The sign-in form. The user either types their email and then the 6-digit
 *  code we send them, which needs no redirect, or signs in with X. The X flow
 *  runs launchWebAuthFlow in the background. Either way the session ends up in
 *  chrome.storage.local, and it reaches every other context through
 *  useSession's storage listener. The settings page renders this form, and so
 *  do the note overlays when a signed-out reader tries to vote or write, so
 *  nobody is sent off to the toolbar icon. `surface` says which of them hosted
 *  the sign-in, for the funnel. `onDismiss` adds a close button; the settings
 *  page leaves it out because its form has nowhere to go. */
export function LoginPanel({ surface = "settings", onDismiss }: { surface?: "settings" | "overlay"; onDismiss?: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  // Whether the code signs into an account or attaches the email to the
  // current anonymous one. Decided when the code is sent, needed to verify it.
  const [flow, setFlow] = useState<EmailFlow>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPendingEmail().then((pending) => {
      if (pending) {
        setEmail(pending.email);
        setFlow(pending.flow);
        setStage("code");
      }
    });
  }, []);

  const backToEmail = async () => {
    await clearPendingEmail();
    setStage("email");
    setCode("");
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    track("sign_in_started", { method: "email", surface });
    const { error, flow: sentFlow } = await signInWithEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    // "done" means the email attached without a code (confirmations off on
    // this backend). The session already updated, so there is nothing left
    // for this form to do.
    if (sentFlow === "done") return;
    setFlow(sentFlow);
    await setPendingEmail(email.trim(), sentFlow);
    setStage("code");
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await verifyEmailCode(email.trim(), code.trim(), flow);
    setBusy(false);
    if (error) return setError(error.message);
    await clearPendingEmail();
  };

  const signInWithX = async () => {
    setBusy(true);
    setError(null);
    track("sign_in_started", { method: "twitter", surface });
    const result = await browser.runtime.sendMessage({ type: "cn-signin-x" }) as { ok: boolean; error?: string };
    setBusy(false);
    if (!result?.ok) setError(result?.error ?? "X sign-in failed");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Sign in to keep your votes and notes across devices</p>
        {onDismiss && <IconButton label="Not now" onClick={onDismiss}>✕</IconButton>}
      </div>
      {stage === "email" ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={FIELD}
          />
          <button type="submit" disabled={busy || !email.includes("@")} className={BUTTON}>
            Send code
          </button>
        </form>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="text-xs text-gray-500 dark:text-gray-400">Enter the code we sent to {email.trim()}.</p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`${FIELD} tracking-widest`}
            />
            <button type="submit" disabled={busy || code.trim().length < EMAIL_OTP_LENGTH} className={BUTTON}>
              Verify
            </button>
          </div>
          <button type="button" onClick={backToEmail} className={`text-xs ${QUIET_LINK}`}>
            Different email
          </button>
        </form>
      )}
      <button
        onClick={signInWithX}
        disabled={busy}
        className={`w-full ${SECONDARY_BUTTON}`}
      >
        Sign in with 𝕏
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
