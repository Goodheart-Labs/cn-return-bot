import { useEffect, useState, type RefCallback } from "react";

const DEFAULT_WIDTH = 800;

export function useResizeWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, width];
}
