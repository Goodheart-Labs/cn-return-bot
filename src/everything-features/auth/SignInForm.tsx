import { useEffect, useState } from "react";
import { track } from "@cn/core/analytics";
import { EMAIL_OTP_LENGTH, getSignedInBefore, signInWithEmailCode, verifyEmailCode, type EmailFlow } from "@cn/core/auth";
import { Button } from "@cn/ui/Button";
import { Input } from "@cn/ui/Field";

/** Where a half-finished email sign-in waits while the reader fetches the
 *  code. The extension needs one: its popup unmounts when the reader switches
 *  to their mail client, and an overlay can be dismissed, which wipes the
 *  form. The website's tab keeps its state, so it passes none. */
export interface PendingEmailStore {
  load(): Promise<{ email: string; flow: EmailFlow } | null>;
  save(email: string, flow: EmailFlow): Promise<void>;
  clear(): Promise<void>;
}

/** The sign-in form of both apps. The reader types their email and then the
 *  code we send them, which needs no redirect and works across devices, or
 *  signs in with X. Each app starts the X flow its own way: the website
 *  redirects, the extension opens a popup from its background script. An app
 *  that cannot run the X flow passes no `signInWithX`, and the button is left
 *  out. The Safari extension is that app, because Safari has no identity API.
 *  `surface` names where the form sits, for the sign-in funnel. */
export function SignInForm({ surface, signInWithX, pendingEmail, onSignedIn }: {
  surface: "web" | "settings" | "overlay";
  signInWithX?: () => Promise<{ error?: string | null }>;
  pendingEmail?: PendingEmailStore;
  onSignedIn?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  // Whether the code signs into an account or attaches the email to the
  // current anonymous one. Decided when the code is sent, needed to verify it.
  const [flow, setFlow] = useState<EmailFlow>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Explains why the form is here at all when anonymous participation was
  // refused because this browser has held a real account before.
  const [signedInBefore, setSignedInBefore] = useState(false);

  useEffect(() => {
    void getSignedInBefore().then(setSignedInBefore);
    void pendingEmail?.load().then((pending) => {
      if (!pending) return;
      setEmail(pending.email);
      setFlow(pending.flow);
      setStage("code");
    });
  }, [pendingEmail]);

  const run = async (action: () => Promise<string | null | undefined>) => {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure);
  };

  const sendCode = () =>
    run(async () => {
      track("sign_in_started", { method: "email", surface });
      const sent = await signInWithEmailCode(email.trim());
      if (sent.error) return sent.error.message;
      // "done" means the email attached without a code, on a backend with
      // email confirmations turned off. The session already updated.
      if (sent.flow === "done") {
        onSignedIn?.();
        return null;
      }
      setFlow(sent.flow);
      await pendingEmail?.save(email.trim(), sent.flow);
      setStage("code");
      return null;
    });

  const verify = () =>
    run(async () => {
      const { error: verifyError } = await verifyEmailCode(email.trim(), code.trim(), flow);
      if (verifyError) return verifyError.message;
      await pendingEmail?.clear();
      onSignedIn?.();
      return null;
    });

  const backToEmail = async () => {
    await pendingEmail?.clear();
    setStage("email");
    setCode("");
    setError(null);
  };

  const startX = (startXFlow: NonNullable<typeof signInWithX>) =>
    run(async () => {
      track("sign_in_started", { method: "twitter", surface });
      return (await startXFlow()).error;
    });

  return (
    <div className="space-y-2">
      {signedInBefore && (
        <p className="text-xs text-fg-muted">
          You have signed in on this browser before, so voting and writing need a sign-in.
        </p>
      )}
      {stage === "email" ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0"
          />
          <Button type="submit" disabled={busy || !email.includes("@")}>
            Send code
          </Button>
        </form>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <p className="text-xs text-fg-muted">Enter the code we sent to {email.trim()}.</p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              name="one-time-code"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="flex-1 min-w-0 tracking-widest"
            />
            <Button type="submit" disabled={busy || code.trim().length < EMAIL_OTP_LENGTH}>
              Verify
            </Button>
          </div>
          <Button variant="quiet" className="text-xs" onClick={() => void backToEmail()}>
            Use a different email
          </Button>
        </form>
      )}
      {signInWithX && (
        <Button variant="secondary" className="w-full" onClick={() => void startX(signInWithX)} disabled={busy}>
          Sign in with 𝕏
        </Button>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
