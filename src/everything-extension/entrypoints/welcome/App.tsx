import { useState } from "react";
import { browser } from "#imports";
import { BUTTON, CARD, QUIET_LINK, SECONDARY_BUTTON } from "../../../everything-shared/ui";
import { GroupIcon } from "../../components/ClaimNoteStack";
import { markWelcomeSeen, updateSettings } from "../../utils/settings";

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
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className={`${CARD} w-full max-w-xl p-8 space-y-6`}>
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-blue-600 [&_svg]:h-[18px] [&_svg]:w-[18px]">
              <GroupIcon />
            </span>
            <h1 className="text-xl font-extrabold text-gray-900">Welcome to Common Notes</h1>
          </div>
          <p className="text-[15px] leading-relaxed text-gray-600">
            Common Notes shows fact-checks right where you read. When a post or video makes a claim we
            have checked, a note appears next to the exact passage, with sources you can follow.
          </p>
          <p className="text-[15px] leading-relaxed text-gray-600">
            Anyone can rate a note or write one. You don't need an account, and you don't need to be an
            expert.
          </p>
        </div>

        <div className="border-t border-gray-200 pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">One question before you start</h2>
          <p className="text-sm leading-relaxed text-gray-600">
            May we save which posts you open on Substack, YouTube, and LessWrong? We use it to decide
            which posts to check next. It is anonymous: just the link and the time, never your account
            or the rest of your browsing.
          </p>
          {answered === null ? (
            <div className="flex gap-2">
              <button onClick={() => void answer(true)} className={BUTTON}>
                Yes, count my visits
              </button>
              <button onClick={() => void answer(false)} className={SECONDARY_BUTTON}>
                No thanks
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-green-700">
              {answered
                ? "Thanks! You're set. Open a post on a covered site and the notes will be there."
                : "All right, we won't count your visits. Open a post on a covered site and the notes will be there."}
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
