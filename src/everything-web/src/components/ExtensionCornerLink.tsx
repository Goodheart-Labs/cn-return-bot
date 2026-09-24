import { FLOATING_CARD, SECONDARY_BUTTON } from "../../../everything-shared/ui";

export const EXTENSION_STORE_LINKS = [
  { label: "Chrome", url: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij" },
  { label: "Firefox", url: "https://addons.mozilla.org/en-US/firefox/addon/common-notes/" },
] as const;

export function ExtensionCornerLink() {
  return (
    // 50vw - 464px is the empty gutter right of the note column (16rem sidebar, 40rem column, page padding).
    <aside className={`${FLOATING_CARD} hidden min-[1440px]:block fixed bottom-4 right-4 z-10 w-[min(20rem,calc(50vw_-_496px))] p-4`}>
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 text-balance">See Common Notes as you browse?</p>
      <div className="flex gap-2 mt-3">
        {EXTENSION_STORE_LINKS.map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer" className={`${SECONDARY_BUTTON} flex-1 text-center`}>
            {label}
          </a>
        ))}
      </div>
    </aside>
  );
}
