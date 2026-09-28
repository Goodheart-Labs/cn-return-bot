import { track } from "@cn/core/analytics";
import { buttonVariants } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";

export const EXTENSION_STORE_LINKS = [
  { label: "Chrome", url: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij" },
  { label: "Firefox", url: "https://addons.mozilla.org/en-US/firefox/addon/common-notes/" },
] as const;

export function ExtensionCornerLink() {
  return (
    // 50vw - 464px is the empty gutter right of the note column (16rem sidebar, 40rem column, page padding).
    <aside className={cn(cardVariants({ elevation: "floating" }), "hidden min-[1440px]:block fixed bottom-4 right-4 z-10 w-[min(20rem,calc(50vw_-_496px))] p-4")}>
      <p className="text-sm font-semibold text-fg text-balance">See Common Notes as you browse?</p>
      <div className="flex gap-2 mt-3">
        {EXTENSION_STORE_LINKS.map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer" onClick={() => track("extension_store_clicked", { browser: label })} className={cn(buttonVariants({ variant: "secondary" }), "flex-1")}>
            {label}
          </a>
        ))}
      </div>
    </aside>
  );
}
