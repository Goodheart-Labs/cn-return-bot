import { useEffect, useRef, useState } from "react";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";

/** The paragraph surrounding the claim, with the quoted excerpt in bold. It sits
 *  beside the note card so the correction can be read in its original context.
 *  The website and the note review dashboard both show it. */
export function ContextParagraph({ paragraph, quote, bare, fitTo }: {
  paragraph: string;
  quote: string;
  bare?: boolean;
  /** Clamps the paragraph to this element's height rather than to a fixed number
   *  of lines. The element is the note card beside it. A short context is not
   *  clamped at all and gets no button. Only a context that would grow taller
   *  than the card is folded (Nathan, 2026-07-14). */
  fitTo?: React.RefObject<HTMLDivElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [capPx, setCapPx] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const target = fitTo?.current;
    if (!target) return;
    const measure = () => {
      const cap = Math.max(160, target.offsetHeight - 28); // Leave room for the button.
      setCapPx(cap);
      // We can only judge overflow while the full paragraph is in the DOM. Once
      // it is clamped we render a slice of it, and the height of that slice says
      // nothing about the height of the whole paragraph.
      if (bodyRef.current && (expanded || !overflows)) {
        setOverflows(bodyRef.current.scrollHeight > cap + 12);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [fitTo, paragraph, expanded, overflows]);
  // We only fit to a height where there is a neighbouring card to measure
  // against, which is the side column at the xl breakpoint. The mobile rendering
  // sits behind its own "Show surrounding context" toggle. The reader asked for
  // the context there, so all of it is shown.
  const clampable = fitTo ? overflows : false;
  const fullIdx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  // When the paragraph is clamped, the visible window starts just before the
  // quote, so the bolded span is what the reader actually sees. Expanding it
  // restores the full paragraph.
  let text = paragraph;
  let idx = fullIdx;
  let ellipsis = false;
  if (clampable && !expanded && fullIdx > 140) {
    const start = paragraph.lastIndexOf(" ", fullIdx - 120) + 1;
    text = paragraph.slice(start);
    idx = fullIdx - start;
    ellipsis = true;
  }
  return (
    <div className={cn("text-2xs text-fg-muted", !bare && "border-l-2 border-line-strong pl-3")}>
      <div
        ref={bodyRef}
        style={clampable && !expanded
          ? fitTo && capPx
            ? { maxHeight: capPx, overflow: "hidden" }
            : { display: "-webkit-box", WebkitLineClamp: 7, WebkitBoxOrient: "vertical", overflow: "hidden" }
          : undefined}
      >
        {ellipsis && "… "}
        {idx < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, idx)}
            <strong className="font-semibold text-fg">{text.slice(idx, idx + quote.length)}</strong>
            {text.slice(idx + quote.length)}
          </>
        )}
      </div>
      {clampable && (
        <Button variant="link" className="mt-1 text-2xs" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
