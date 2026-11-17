import { useEffect, useRef, useState } from "react";
import { pointerIntersection } from "@dnd-kit/collision";
import { AutoScroller, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { DragDropProvider, DragOverlay, KeyboardSensor, useDragOperation, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { positionAfterMove, type CuratedNoteRow } from "@cn/core/bestNotes";
import type { NoteRow, ProjectHeader } from "@cn/core/types";
import { cn } from "@cn/ui/cn";
import { ProjectAvatar } from "../../components/ProjectAvatar";

/** One note in drag mode: its row on the list, the note and its creator. */
export interface ReorderEntry {
  row: CuratedNoteRow;
  note: NoteRow;
  project: ProjectHeader | undefined;
}

/** How long the dragged row must stay still before the others make room. */
const HOLD_STILL_MS = 400;

/** How far the pointer may drift, in pixels, and still count as holding still. */
const STILL_DISTANCE = 8;

/** On a touch screen a drag starts after holding a row this long, so a swipe
 *  still scrolls the page. A mouse starts dragging after moving a few pixels. */
const TOUCH_HOLD_MS = 250;
const TOUCH_TOLERANCE = 5;
const MOUSE_START_DISTANCE = 4;

/** Edge scrolling starts in the top and bottom 15% of the screen and gets
 *  faster towards the edge. */
const EDGE_ZONE = 0.15;
const EDGE_ACCELERATION = 40;

/** How the other rows slide when they make room. */
const ROW_TRANSITION = { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" };

const SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: TOUCH_HOLD_MS, tolerance: TOUCH_TOLERANCE })]
        : [new PointerActivationConstraints.Distance({ value: MOUSE_START_DISTANCE })],
  }),
  KeyboardSensor,
];

/** The first line of a note, which is what a row shows of it. */
const firstLine = (note: NoteRow) => note.note.split("\n")[0] ?? "";

function RowContent({ entry, rank }: { entry: ReorderEntry; rank: number }) {
  return (
    <>
      <span className="w-9 shrink-0 font-title text-sm font-bold text-fg-secondary">#{rank}</span>
      {entry.project && <ProjectAvatar project={entry.project} size={20} />}
      <span className="hidden w-36 shrink-0 truncate text-sm text-fg-secondary sm:block">{entry.project?.name}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{firstLine(entry.note)}</span>
      <span aria-hidden="true" className="shrink-0 select-none font-mono text-fg-subtle">
        ⋮⋮
      </span>
    </>
  );
}

const ROW = "flex items-center gap-3 rounded-control border px-3 py-2";

function Row({ entry, index }: { entry: ReorderEntry; index: number }) {
  const { ref, isDragSource } = useSortable({
    id: entry.row.note_id,
    index,
    collisionDetector: pointerIntersection,
    transition: ROW_TRANSITION,
  });
  const dragging = !!useDragOperation().source;
  return (
    <li
      ref={ref}
      className={cn(
        ROW,
        "cursor-grab touch-manipulation bg-surface transition-[opacity,filter]",
        isDragSource ? "border-dashed border-link bg-tint [&>*]:invisible" : "border-line",
        dragging && !isDragSource && "opacity-40 grayscale",
      )}
    >
      <RowContent entry={entry} rank={index + 1} />
    </li>
  );
}

/** The best notes as one-line rows that an admin drags into order. A dragged
 *  row floats above the list, which dims behind it. The page scrolls by itself
 *  near the top and bottom edges. The other rows make room only once the
 *  dragged row has stayed still for a moment, and dropping it saves its new
 *  place. In a list narrowed to one creator, the note lands right below the
 *  note now shown above it. */
export function BestNotesReorder({ entries, list, onMove }: {
  entries: ReorderEntry[];
  list: CuratedNoteRow[];
  onMove: (noteId: string, position: number) => void;
}) {
  const [order, setOrder] = useState(() => entries.map((entry) => entry.row.note_id));
  // The drag handlers read the order through a ref, so they see the latest one.
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  const orderAtStart = useRef(order);
  const target = useRef<string | null>(null);
  const anchor = useRef({ x: 0, y: 0 });
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const byId = new Map(entries.map((entry) => [entry.row.note_id, entry]));
  // A note taken off the list by another admin during drag mode drops out here.
  const shown = order.flatMap((noteId) => byId.get(noteId) ?? []);

  /** Makes room at the row under the pointer by moving the dragged row there. */
  const makeRoom = (sourceId: string) => {
    const targetId = target.current;
    if (!targetId || targetId === sourceId) return;
    setOrder((current) => arrayMove(current, current.indexOf(sourceId), current.indexOf(targetId)));
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { current } = event.operation.position;
    const sourceId = event.operation.source?.id;
    if (Math.hypot(current.x - anchor.current.x, current.y - anchor.current.y) <= STILL_DISTANCE || typeof sourceId !== "string") return;
    // The pointer moved on, so the hold starts again from here. A row that just
    // made room waits for the next movement, so holding still never swaps it back.
    anchor.current = { x: current.x, y: current.y };
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => makeRoom(sourceId), HOLD_STILL_MS);
  };

  const onDragOver = (event: DragOverEvent) => {
    // dnd-kit would move the rows at once. We move them after the hold instead.
    event.preventDefault();
    const targetId = event.operation.target?.id;
    target.current = typeof targetId === "string" ? targetId : null;
  };

  const onDragEnd = (event: DragEndEvent) => {
    clearTimeout(holdTimer.current);
    const sourceId = event.operation.source?.id;
    if (event.canceled || typeof sourceId !== "string") {
      setOrder(orderAtStart.current);
      return;
    }
    const final = orderRef.current;
    const index = final.indexOf(sourceId);
    if (index === orderAtStart.current.indexOf(sourceId)) return;
    onMove(sourceId, positionAfterMove(list, sourceId, final[index - 1], final[index + 1]));
  };

  return (
    <DragDropProvider
      sensors={SENSORS}
      plugins={(defaults) => [...defaults, AutoScroller.configure({ acceleration: EDGE_ACCELERATION, threshold: { x: 0, y: EDGE_ZONE } })]}
      onDragStart={(event) => {
        orderAtStart.current = orderRef.current;
        target.current = null;
        anchor.current = { ...event.operation.position.current };
      }}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <ol className="mx-auto max-w-[48rem] space-y-1.5">
        {shown.map((entry, index) => (
          <Row key={entry.row.note_id} entry={entry} index={index} />
        ))}
      </ol>
      <DragOverlay>
        {(source) => {
          const entry = typeof source.id === "string" ? byId.get(source.id) : undefined;
          return entry ? (
            <div className={cn(ROW, "cursor-grabbing border-link bg-surface shadow-lg")}>
              <RowContent entry={entry} rank={order.indexOf(entry.row.note_id) + 1} />
            </div>
          ) : null;
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
