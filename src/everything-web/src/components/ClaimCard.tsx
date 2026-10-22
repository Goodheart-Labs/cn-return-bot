import { useRef, useState, type ReactNode } from "react";
import type { ClaimRef, FeedItemRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { ContextParagraph } from "@cn/features/notes/ContextParagraph";
import { ClaimContent, claimContent } from "./ClaimContent";

/** The images a claim is grounded in, which are usually Substack charts or
 *  screenshots. They sit above the claim's context. Each one links out to the
 *  full-resolution original. */
function ClaimImages({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt="Claim source"
            loading="lazy"
            className="max-h-48 w-auto rounded-control border border-line object-contain"
          />
        </a>
      ))}
    </div>
  );
}

/** A card about one claim: the claim in its source at the top, and below it
 *  whatever the page shows about the claim. On a wide screen the paragraph
 *  around the claim sits beside the card. On a narrow one it opens above the
 *  card behind a button. */
export function ClaimCard({ id, claim, paragraph, post, byline, children }: {
  id?: string;
  claim: ClaimRef;
  /** The post's paragraph around the claim. It contains the claim's quote. */
  paragraph: string | null;
  post?: FeedItemRow;
  /** A line at the top of the card. */
  byline?: ReactNode;
  children: ReactNode;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  const cardColRef = useRef<HTMLDivElement>(null);
  const quoteInParagraph = claim.context_quote ?? claim.claim;
  return (
    <div id={id} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4 items-start">
      {paragraph && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} fitTo={cardColRef} />
        </div>
      )}
      {paragraph && (
        <div
          className="xl:hidden w-full max-w-[40rem] mx-auto"
          style={{ display: "grid", gridTemplateRows: ctxOpen ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
          aria-hidden={!ctxOpen}
        >
          <div className="overflow-hidden min-h-0">
            <div className="mb-2">
              <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} bare />
            </div>
          </div>
        </div>
      )}
      <Card ref={cardColRef} className="p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
        {byline && <div className="mb-3">{byline}</div>}
        <div className="mb-4">
          {claim.image_urls.length > 0 && <ClaimImages urls={claim.image_urls} />}
          {paragraph && (
            <Button variant="link" className="xl:hidden text-xs mb-2" onClick={() => setCtxOpen((o) => !o)}>
              {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
            </Button>
          )}
          <ClaimContent content={claimContent(claim, post)} />
        </div>
        {children}
      </Card>
    </div>
  );
}
