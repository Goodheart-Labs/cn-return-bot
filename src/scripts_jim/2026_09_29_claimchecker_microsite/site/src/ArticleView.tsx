import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Article, LabClaim, LabRun } from "../../labRun";
import { SELECTED_TINT, anchorClaims, anchorTop, claimsAtClick, tintOf, type Anchor, type Tint } from "./anchoring";
import { ClaimCard } from "./ClaimCard";

/** The vertical space between two stacked margin cards, in pixels. */
const CARD_GAP = 12;
const ALL_TINTS: Tint[] = ["lab-note", "lab-no-note", "lab-skipped", "lab-error"];

/** The article's own markup. It is memoised so React never rewrites the
 *  markup after the first render, because the anchors point into its nodes. */
const ArticleBody = memo(function ArticleBody({ html, bodyRef }: { html: string; bodyRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={bodyRef} className="article" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Tints every visible claim by its category, and the selected ones on top. */
function applyTints(anchors: Map<string, Anchor>, claims: LabClaim[], visible: Set<string>, selected: string[]) {
  const byTint = new Map<string, Range[]>([...ALL_TINTS, SELECTED_TINT].map((t) => [t, []]));
  for (const claim of claims) {
    const anchor = anchors.get(claim.id);
    if (anchor?.kind !== "text" || !visible.has(claim.id)) continue;
    byTint.get(selected.includes(claim.id) ? SELECTED_TINT : tintOf(claim))!.push(anchor.range);
  }
  // The root tsconfig's DOM types predate the registry's map methods, which
  // every current browser has.
  const registry = CSS.highlights as unknown as Map<string, Highlight>;
  for (const [tint, ranges] of byTint) registry.set(tint, new Highlight(...ranges));
  for (const claim of claims) {
    const anchor = anchors.get(claim.id);
    if (anchor?.kind !== "image") continue;
    anchor.image.classList.toggle("lab-image-claim", visible.has(claim.id) && claim.notes.length > 0);
    anchor.image.classList.toggle("lab-image-selected", selected.includes(claim.id));
  }
}

/** Stacks the cards down the margin. Each card wants to sit level with its
 *  passage, but never overlaps the card above it, so on a dense stretch of
 *  text the cards drift below their passages. */
function stackCards(wanted: { id: string; top: number }[], heights: Map<string, number>): Map<string, number> {
  const tops = new Map<string, number>();
  let nextFree = 0;
  for (const { id, top } of [...wanted].sort((a, b) => a.top - b.top)) {
    const placed = Math.max(top, nextFree);
    tops.set(id, placed);
    nextFree = placed + (heights.get(id) ?? 0) + CARD_GAP;
  }
  return tops;
}

/** Re-renders whenever the article's layout can have moved: a window resize,
 *  or an image finishing loading above an anchor. The re-render is what makes
 *  the margin cards measure their passages again. */
function useRerenderOnLayoutShift(container: React.RefObject<HTMLElement | null>): void {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVersion((v) => v + 1));
    };
    const element = container.current;
    // Image load events do not bubble, so they are caught on the way down.
    element?.addEventListener("load", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      element?.removeEventListener("load", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, [container]);
}

export function ArticleView({ article, run, showAll }: { article: Article; run: LabRun; showAll: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [anchors, setAnchors] = useState(new Map<string, Anchor>());
  /** Claims whose passage was clicked. A claim with notes has a card anyway;
   *  clicking one without notes opens a card for it. */
  const [selected, setSelected] = useState<string[]>([]);
  const [cardTops, setCardTops] = useState(new Map<string, number>());
  useRerenderOnLayoutShift(wrapperRef);

  const visible = useMemo(
    () => new Set(run.claims.filter((c) => showAll || c.notes.length > 0).map((c) => c.id)),
    [run, showAll],
  );
  const carded = run.claims.filter((c) => c.notes.length > 0 || (selected.includes(c.id) && visible.has(c.id)));
  const unplaced = run.claims.filter((c) => visible.has(c.id) && !anchors.has(c.id));

  useLayoutEffect(() => {
    setAnchors(anchorClaims(bodyRef.current!, run.claims));
    setSelected([]);
  }, [run]);

  useEffect(() => applyTints(anchors, run.claims, visible, selected), [anchors, run, visible, selected]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current!;
    const wanted = carded.flatMap((c) => {
      const anchor = anchors.get(c.id);
      return anchor ? [{ id: c.id, top: anchorTop(anchor, wrapper) }] : [];
    });
    const heights = new Map([...cardRefs.current].map(([id, el]) => [id, el.offsetHeight]));
    const next = stackCards(wanted, heights);
    // Only a real change is stored, or measuring would re-render forever.
    const changed = next.size !== cardTops.size || [...next].some(([id, top]) => cardTops.get(id) !== top);
    if (changed) setCardTops(next);
  });

  useEffect(() => {
    const body = bodyRef.current!;
    const onClick = (event: MouseEvent) => {
      const hit = claimsAtClick(event, anchors, visible);
      if (hit.length > 0) setSelected(hit);
    };
    body.addEventListener("click", onClick);
    return () => body.removeEventListener("click", onClick);
  }, [anchors, visible]);

  const marginHeight = Math.max(0, ...[...cardTops].map(([id, top]) => top + (cardRefs.current.get(id)?.offsetHeight ?? 0)));

  return (
    <div ref={wrapperRef} className="relative flex gap-8 items-start">
      <div className="flex-1 min-w-0 max-w-[42rem]">
        <h1 className="font-bold mb-2">{article.title}</h1>
        <p className="text-sm text-fg-muted mb-8">
          {article.author} · {article.publishedAt?.slice(0, 10)} ·{" "}
          <a className="text-link underline" href={article.snapshotUrl} target="_blank" rel="noreferrer">
            Wayback Machine copy
          </a>
        </p>
        <ArticleBody html={article.html} bodyRef={bodyRef} />
        {unplaced.length > 0 && (
          <section className="mt-12 border-t border-line pt-6 space-y-3">
            <h2 className="text-lg font-semibold">Claims the page could not place ({unplaced.length})</h2>
            <p className="text-sm text-fg-muted">The extension would not show these either, because their quote is not found in the text.</p>
            {unplaced.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} showVotes={run.source === "production"} selected={false} onSelect={() => {}} />
            ))}
          </section>
        )}
      </div>
      <aside className="relative w-[26rem] shrink-0" style={{ height: marginHeight }}>
        {carded.map((claim) => {
          const top = cardTops.get(claim.id);
          if (!anchors.has(claim.id)) return null;
          return (
            <div
              key={claim.id}
              ref={(el) => {
                if (el) cardRefs.current.set(claim.id, el);
                else cardRefs.current.delete(claim.id);
              }}
              className="absolute left-0 right-0 transition-[top] duration-200"
              style={{ top: top ?? 0, visibility: top === undefined ? "hidden" : "visible" }}
            >
              <ClaimCard
                claim={claim}
                showVotes={run.source === "production"}
                selected={selected.includes(claim.id)}
                onSelect={() => setSelected([claim.id])}
                onClose={claim.notes.length === 0 ? () => setSelected((s) => s.filter((id) => id !== claim.id)) : undefined}
              />
            </div>
          );
        })}
      </aside>
    </div>
  );
}
