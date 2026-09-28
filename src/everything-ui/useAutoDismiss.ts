import { useEffect, useEffectEvent, useState } from "react";

/** Makes a transient card go away by itself. Once the card has stood for
 *  `dwellMs` without being used, it fades for `fadeMs` and then `onDismiss`
 *  runs. While `paused` is true, for example while the pointer is on the card,
 *  the clock stops and a running fade is undone; releasing it starts the wait
 *  from zero. Returns whether the card should render faded. */
export function useAutoDismiss({ dwellMs, fadeMs, paused, onDismiss }: {
  dwellMs: number;
  fadeMs: number;
  paused: boolean;
  onDismiss: () => void;
}): { fading: boolean } {
  const [fading, setFading] = useState(false);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (paused) return;
    const fade = setTimeout(() => setFading(true), dwellMs);
    const done = setTimeout(dismiss, dwellMs + fadeMs);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
      setFading(false);
    };
  }, [paused, dwellMs, fadeMs]);
  return { fading };
}
