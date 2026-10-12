import type { ReactNode } from "react";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** A wrapper that keeps mouse events inside our overlay. A mousedown would
 *  otherwise close an open note through the page-level listeners, and a click
 *  would reach the host page and our own passage hit test. React attaches its
 *  listeners to the root the wrapper renders in, so stopping the event here
 *  halts the native event before it reaches the document. Key presses need no
 *  wrapper: createOverlayUi stops them for every overlay. The wrapper itself
 *  has no meaning of its own, hence the presentation role. */
export function EventShield({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" onMouseDown={stop} onClick={stop}>
      {children}
    </div>
  );
}
