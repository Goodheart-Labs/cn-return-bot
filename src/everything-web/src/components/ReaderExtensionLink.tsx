import { BUTTON, CARD, SECONDARY_BUTTON } from "../../../everything-shared/ui";

const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij";
const FIREFOX_EXTENSION_URL = "https://addons.mozilla.org/firefox/addon/common-notes/";

/** Render the card once at the end of the reader; compact links lead to its
 * browser choices, which also work for readers visiting on their phones. */
export function ReaderExtensionLink({
  variant = "compact",
  className = "",
}: {
  variant?: "compact" | "card";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <a
        href="#get-extension"
        className={`${SECONDARY_BUTTON} inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 ${className}`}
      >
        Get the extension
        <span aria-hidden="true">↓</span>
      </a>
    );
  }

  return (
    <section
      id="get-extension"
      aria-labelledby="get-extension-title"
      className={`${CARD} scroll-mt-24 p-6 sm:p-8 ${className}`}
    >
      <h2 id="get-extension-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Common Notes, wherever you read
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-300">
        See notes alongside articles and YouTube videos on their original sites.
        Get the browser extension to read, rate, and add notes across the web.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <a
          href={CHROME_EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BUTTON} inline-flex min-h-11 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600`}
        >
          Add to Chrome
          <span className="sr-only"> (opens the Chrome Web Store in a new tab)</span>
        </a>
        <a
          href={FIREFOX_EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${SECONDARY_BUTTON} inline-flex min-h-11 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600`}
        >
          Add to Firefox
          <span className="sr-only"> (opens Firefox Add-ons in a new tab)</span>
        </a>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
        Available for desktop browsers. You can keep reading this page on any device.
      </p>
    </section>
  );
}
