import { track } from "@cn/core/analytics";
import { buttonVariants } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { browserById } from "../lib/extensionStores";

const CORNER_BROWSERS = [browserById("chrome"), browserById("firefox")];

export function ExtensionCornerLink() {
  return (
    // 50vw - 464px is the empty gutter right of the note column (16rem sidebar, 40rem column, page padding).
    <aside className={cn(cardVariants({ elevation: "floating" }), "hidden min-[1440px]:block fixed bottom-4 right-4 z-10 w-[min(20rem,calc(50vw_-_496px))] p-4")}>
      <p className="text-sm font-semibold text-fg text-balance">See Common Notes as you browse?</p>
      <div className="flex gap-2 mt-3">
        {CORNER_BROWSERS.map(({ name, storeUrl }) => (
          <a key={name} href={storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => track("extension_store_clicked", { browser: name })} className={cn(buttonVariants({ variant: "secondary" }), "flex-1")}>
            {name}
          </a>
        ))}
      </div>
    </aside>
  );
}
