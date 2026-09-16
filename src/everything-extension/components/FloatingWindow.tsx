import { useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { EYEBROW, FLOATING_CARD } from "../../everything-shared/ui";
import { IconButton } from "../../everything-web/src/components/IconButton";

/** A card's box in page coordinates. Page coordinates are viewport
 *  coordinates plus the page's scroll offset, measured from the top-left
 *  corner of the document, so a card placed this way scrolls with the page
 *  like the content around it. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_WIDTH_PX = 280;
const MIN_HEIGHT_PX = 160;
/** How wide the invisible strip along each edge and corner is. Inside it the
 *  pointer turns into a resize cursor and a press starts resizing. */
const GRIP_PX = 8;

/** The edge or corner a resize gesture pulls on. The letters are compass
 *  directions, which is also how the CSS cursor names read: `nwse-resize` is
 *  the diagonal cursor for the north-west and south-east corners. */
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const GRIPS: { edge: Edge; cursor: string; style: CSSProperties }[] = [
  { edge: "n", cursor: "ns-resize", style: { top: -GRIP_PX / 2, left: GRIP_PX, right: GRIP_PX, height: GRIP_PX } },
  { edge: "s", cursor: "ns-resize", style: { bottom: -GRIP_PX / 2, left: GRIP_PX, right: GRIP_PX, height: GRIP_PX } },
  { edge: "e", cursor: "ew-resize", style: { right: -GRIP_PX / 2, top: GRIP_PX, bottom: GRIP_PX, width: GRIP_PX } },
  { edge: "w", cursor: "ew-resize", style: { left: -GRIP_PX / 2, top: GRIP_PX, bottom: GRIP_PX, width: GRIP_PX } },
  { edge: "nw", cursor: "nwse-resize", style: { top: -GRIP_PX / 2, left: -GRIP_PX / 2, width: GRIP_PX, height: GRIP_PX } },
  { edge: "se", cursor: "nwse-resize", style: { bottom: -GRIP_PX / 2, right: -GRIP_PX / 2, width: GRIP_PX, height: GRIP_PX } },
  { edge: "ne", cursor: "nesw-resize", style: { top: -GRIP_PX / 2, right: -GRIP_PX / 2, width: GRIP_PX, height: GRIP_PX } },
  { edge: "sw", cursor: "nesw-resize", style: { bottom: -GRIP_PX / 2, left: -GRIP_PX / 2, width: GRIP_PX, height: GRIP_PX } },
];

function pageBox(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  return { left: rect.left + window.scrollX, top: rect.top + window.scrollY, width: rect.width, height: rect.height };
}

/** The page's width without its vertical scrollbar. A card is never allowed
 *  past it, because a card poking out of the right edge would give the page a
 *  horizontal scrollbar. */
const pageWidth = () => document.documentElement.clientWidth;

function moved(start: Box, dx: number, dy: number): Box {
  return {
    ...start,
    left: Math.min(Math.max(0, start.left + dx), pageWidth() - start.width),
    top: Math.max(0, start.top + dy),
  };
}

/** Pulling an edge moves that edge and leaves the opposite one in place, so
 *  the box hitting its minimum size stops the pulled edge rather than moving
 *  the fixed one. */
function resized(start: Box, edge: Edge, dx: number, dy: number): Box {
  const box = { ...start };
  if (edge.includes("e")) box.width = Math.min(Math.max(MIN_WIDTH_PX, start.width + dx), pageWidth() - start.left);
  if (edge.includes("w")) {
    box.width = Math.min(Math.max(MIN_WIDTH_PX, start.width - dx), start.left + start.width);
    box.left = start.left + start.width - box.width;
  }
  if (edge.includes("s")) box.height = Math.max(MIN_HEIGHT_PX, start.height + dy);
  if (edge.includes("n")) {
    box.height = Math.min(Math.max(MIN_HEIGHT_PX, start.height - dy), start.top + start.height);
    box.top = start.top + start.height - box.height;
  }
  return box;
}

/** A card that behaves like a desktop window. Its title bar drags it anywhere
 *  on the page, and its edges and corners resize it. Until the reader touches
 *  it, the card sits where `restingStyle` puts it and takes the height of its
 *  content, capped at most of the viewport. The first drag or resize freezes
 *  the box the card had at that moment into explicit page coordinates, and
 *  from then on the card keeps its own size and the body scrolls inside it.
 *  Nothing is remembered: a fresh card starts at rest again. */
export function FloatingWindow({ title, onDismiss, restingStyle, className = "", children, ...divProps }: {
  title: string;
  onDismiss: () => void;
  /** Where the card sits before any interaction, as `left`, `top` and a
   *  `transform` that aligns the card to that point. */
  restingStyle: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "style">) {
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  // The cursor to show everywhere while a gesture runs. The pointer leaves
  // the card during a fast drag, and the page underneath would show its own
  // cursors otherwise.
  const [gestureCursor, setGestureCursor] = useState<string | null>(null);

  /** Runs one press-move-release gesture. Pointer capture, a browser feature,
   *  routes every pointer event to the pressed element until release, so the
   *  gesture continues when the pointer runs ahead of the card. */
  const startGesture = (e: React.PointerEvent, cursor: string, apply: (start: Box, dx: number, dy: number) => Box) => {
    if (e.button !== 0 || !outer.current) return;
    e.preventDefault();
    const start = pageBox(outer.current);
    const origin = { x: e.clientX, y: e.clientY };
    setBox(start);
    setGestureCursor(cursor);
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const onMove = (move: PointerEvent) => setBox(apply(start, move.clientX - origin.x, move.clientY - origin.y));
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("pointercancel", onEnd);
      setGestureCursor(null);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("pointercancel", onEnd);
  };

  const startDrag = (e: React.PointerEvent) => {
    // A press on the dismiss button is a click, not the start of a drag.
    if ((e.target as Element).closest("button")) return;
    startGesture(e, "grabbing", moved);
  };

  const style: CSSProperties = box
    ? { position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height }
    : { position: "absolute", ...restingStyle };

  return (
    <div
      ref={outer}
      {...divProps}
      style={style}
      className={`flex flex-col ${box ? "" : "max-w-[85vw] max-h-[70vh]"} ${FLOATING_CARD} ${className}`}
    >
      <div
        onPointerDown={startDrag}
        className="flex items-start justify-between gap-2 px-4 pt-4 pb-2 cursor-grab select-none"
      >
        <span className={EYEBROW}>{title}</span>
        <IconButton label="Dismiss for this video" onClick={onDismiss}>✕</IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
      {GRIPS.map(({ edge, cursor, style: gripStyle }) => (
        <div
          key={edge}
          onPointerDown={(e) => startGesture(e, cursor, (start, dx, dy) => resized(start, edge, dx, dy))}
          style={{ position: "absolute", cursor, ...gripStyle }}
        />
      ))}
      {gestureCursor && <div style={{ position: "fixed", inset: 0, cursor: gestureCursor }} />}
    </div>
  );
}
