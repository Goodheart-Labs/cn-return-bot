import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MAX_EMAIL_LENGTH, joinSafariWaitlist } from "@cn/core/safariWaitlist";
import { Button } from "@cn/ui/Button";
import { Input } from "@cn/ui/Field";

/** What the Safari tab of the install section shows while Safari has no
 *  version yet: a field to leave an email address for one email when it is
 *  out. A form-filling bot also fills the hidden "website" field, which no
 *  person sees. Such a sign-up looks successful but is never sent. */
export function SafariWaitlist() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const join = useMutation({ mutationFn: () => (website ? Promise.resolve() : joinSafariWaitlist(email.trim())) });

  if (join.isSuccess) {
    return (
      <p role="status" className="text-base text-fg-secondary">
        Thanks. We'll email you when the Safari extension is out.
      </p>
    );
  }

  return (
    <div className="w-full max-w-md space-y-4">
      <p className="text-base text-fg-secondary">The Safari version is coming soon.</p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          join.mutate();
        }}
      >
        <Input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={MAX_EMAIL_LENGTH}
          aria-label="Your email address"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 text-base"
        />
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <Button type="submit" disabled={join.isPending}>
          Email me
        </Button>
      </form>
      {join.isError ? (
        <p role="alert" className="text-sm text-negative">
          We could not save your email. Please check the address and try again.
        </p>
      ) : (
        <p className="text-sm text-fg-muted">We'll send one email when the Safari extension is out, and nothing else.</p>
      )}
    </div>
  );
}
