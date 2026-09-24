import { CARD, LINK } from "../../../everything-shared/ui";

export const EXTENSION_STORE_LINKS = [
  { label: "Chrome", url: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij" },
  { label: "Firefox", url: "https://addons.mozilla.org/en-US/firefox/addon/common-notes/" },
] as const;

export function ExtensionCornerLink() {
  return (
    <aside className={`${CARD} hidden xl:block fixed bottom-4 right-4 z-10 w-36 px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300 shadow-sm`}>
      <p>See Common Notes as you browse?</p>
      <div className="flex gap-3 mt-1">
        {EXTENSION_STORE_LINKS.map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {label}
          </a>
        ))}
      </div>
    </aside>
  );
}
