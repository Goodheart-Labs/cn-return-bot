import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "./cn";

/** How far one press of an arrow key moves the edge. */
const KEYBOARD_STEP_PX = 24;

function readStoredWidth(key: string): number | null {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function storeWidth(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // A browser without storage simply forgets the width on reload.
  }
}

/** A side panel whose right edge can be dragged to make it wider or narrower.
 *  The edge is also a keyboard control: focus it and press the left or right
 *  arrow. The width is remembered on this device under `storageKey`. */
export function ResizablePanel({ storageKey, label, defaultWidth, minWidth, maxWidth, className, children }: {
  storageKey: string;
  /** What the panel holds, for the edge's accessible name. */
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  className?: string;
  children: ReactNode;
}) {
  const clamp = (width: number) => Math.min(maxWidth, Math.max(minWidth, width));
  const [width, setWidth] = useState(() => clamp(readStoredWidth(storageKey) ?? defaultWidth));
  const resize = (next: number) => {
    const clamped = clamp(next);
    setWidth(clamped);
    storeWidth(storageKey, clamped);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: globalThis.PointerEvent) => resize(startWidth + move.clientX - startX);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") resize(width - KEYBOARD_STEP_PX);
    else if (event.key === "ArrowRight") resize(width + KEYBOARD_STEP_PX);
    else return;
    event.preventDefault();
  };

  return (
    <div className={cn("relative shrink-0", className)} style={{ width }}>
      {children}
      {/* A focusable separator with a value is WAI-ARIA's "window splitter"
        * pattern, an interactive widget. jsx-a11y counts every separator as
        * static, so its two interactivity rules are switched off here only. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${label}`}
        aria-valuenow={Math.round(width)}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center focus-visible:outline-none"
      >
        <span className="w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-focus group-focus-visible:w-0.5 group-focus-visible:bg-focus" />
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </div>
  );
}
