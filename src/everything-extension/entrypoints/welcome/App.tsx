import { useState } from "react";
import { browser } from "#imports";
import { BUTTON, CARD, QUIET_LINK, SECONDARY_BUTTON } from "../../../everything-shared/ui";
import { GroupIcon } from "../../components/ClaimNoteStack";
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className={`${CARD} w-full max-w-xl p-8 space-y-6`}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-blue-600 [&_svg]:h-[18px] [&_svg]:w-[18px]">
              <GroupIcon />
            </span>
            <h1 className="text-xl font-extrabold text-gray-900">Welcome to Common Notes</h1>
          </div>
          <p className="text-[15px] text-gray-500">Community Notes for Everything</p>
        </div>

        <div className="border-t border-gray-200 pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">One question before you start</h2>
          <p className="text-sm leading-relaxed text-gray-600">
            We generate notes (fact checks or other useful context) on all new posts from specific
            authors and creators on YouTube, Substack, LessWrong, and the Alignment Forum. If you want, we can save the
            posts you visit, without any user data attached, and then automatically generate notes on
            the authors you read and the channels you watch.
          </p>
          {answered === null ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void answer(true)} className={BUTTON}>
                Yes, generate notes on the authors and creators I visit
              </button>
              <button onClick={() => void answer(false)} className={SECONDARY_BUTTON}>
                No thanks
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-green-700">
              {answered
                ? "Thanks! We will check new posts of the creators you visit."
                : "All right, we won't save your visits. Notes still show on everything we check."}
            </p>
          )}
          <p className="text-xs text-gray-400">
            You can change this any time in the{" "}
            <button onClick={() => void browser.runtime.openOptionsPage()} className={QUIET_LINK}>
              settings
            </button>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
