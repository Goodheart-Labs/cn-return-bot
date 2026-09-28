import type { ReactNode } from "react";

/** Spread this onto the outermost wrapper of an overlay. It keeps our keyboard
 *  events from reaching the host page. Shadow retargeting makes the page see
 *  those events as coming from the shadow host element rather than from an
 *  input, so the page's own "ignore typing" checks never fire. Without this,
 *  YouTube's single-key shortcuts such as k, f, m, the digits and the arrow keys
 *  would drive the player while somebody types in a composer. */
export const ABSORB_KEYS = {
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  onKeyUp: (e: React.KeyboardEvent) => e.stopPropagation(),
  onKeyPress: (e: React.KeyboardEvent) => e.stopPropagation(),
} as const;

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** A wrapper that keeps every mouse and keyboard event inside our overlay. A
 *  mousedown would otherwise close an open note through the page-level
 *  listeners, a click would reach the host page and our own passage hit test,
 *  and keys typed in a composer would trigger the host page's hotkeys. React
 *  attaches its listeners to the root the wrapper renders in, so stopping the
 *  event here halts the native event before it reaches the document. The
 *  wrapper itself has no meaning of its own, hence the presentation role. */
export function EventShield({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" {...ABSORB_KEYS} onMouseDown={stop} onClick={stop}>
      {children}
    </div>
  );
}
