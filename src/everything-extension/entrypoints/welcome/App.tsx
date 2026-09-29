import { useState } from "react";
import { browser } from "#imports";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { NoteStackIcon } from "@cn/ui/icons";
import { markWelcomeSeen, updateSettings } from "../../utils/settings";

/** How long the confirmation stays on screen before the welcome tab closes
 *  itself. The tab has done its job once the question is answered. */
const CLOSE_AFTER_ANSWER_MS = 1_000;

/** The welcome tab the background opens once after a fresh install. It says
 *  what Common Notes is and asks the one question that has to be answered
 *  before anything else happens: whether we may count which posts the reader
 *  opens. Visit recording stays inert until the question was answered
 *  (utils/linkVisits.ts). */
export function WelcomeApp() {
  const [answered, setAnswered] = useState<null | boolean>(null);

  const answer = async (shareVisits: boolean) => {
    setAnswered(shareVisits);
    await updateSettings({ saveVisits: { substack: shareVisits, youtube: shareVisits, lesswrong: shareVisits } });
    await markWelcomeSeen();
    // The tab closes itself once the answer is saved. window.close works here
    // because the background opened this tab.
    setTimeout(() => window.close(), CLOSE_AFTER_ANSWER_MS);
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl p-8 space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-tint-line bg-tint text-link">
              <NoteStackIcon size={18} />
            </span>
            <h1 className="text-xl font-extrabold text-fg">Welcome to Common Notes</h1>
          </div>
          <p className="text-sm text-fg-muted">Community Notes for Everything</p>
        </div>

        <div className="border-t border-line pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-fg">One question before you start</h2>
          <p className="text-sm leading-relaxed text-fg-secondary">
            We generate notes (fact checks or other useful context) on all new posts from specific
            authors and creators on YouTube, Substack, LessWrong, and the Alignment Forum. If you want, we can save the
            posts you visit, without your account attached, and then automatically generate notes on
            the authors you read and the channels you watch.
          </p>
          {answered === null ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void answer(true)}>Yes, generate notes on the authors and creators I visit</Button>
              <Button variant="secondary" onClick={() => void answer(false)}>No thanks</Button>
            </div>
          ) : (
            <p className="text-sm font-medium text-positive">
              {answered
                ? "Thanks! We will check new posts of the creators you visit."
                : "All right, we won't save your visits. Notes still show on everything we check."}
            </p>
          )}
          <p className="text-xs text-fg-subtle">
            You can change this any time in the{" "}
            <Button variant="quiet" onClick={() => void browser.runtime.openOptionsPage()}>
              settings
            </Button>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
