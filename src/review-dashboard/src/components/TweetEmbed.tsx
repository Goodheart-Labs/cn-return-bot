import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    twttr?: {
      widgets: {
        createTweet(
          tweetId: string,
          container: HTMLElement,
          options?: Record<string, unknown>
        ): Promise<HTMLElement | undefined>;
      };
    };
  }
}

interface TweetEmbedProps {
  tweetId: string;
}

export function TweetEmbed({ tweetId }: TweetEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  // Only attempt to render when the card scrolls into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    setFailed(false);
    setLoading(true);

    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 10;

    const render = () => {
      if (cancelled) return;
      if (!window.twttr?.widgets) {
        if (retries++ >= MAX_RETRIES) {
          setLoading(false);
          setFailed(true);
          return;
        }
        setTimeout(render, 500);
        return;
      }

      window.twttr.widgets
        .createTweet(tweetId, container, {
          conversation: "none",
          cards: "visible",
          theme: "light",
          width: 500,
          dnt: true,
        })
        .then((el) => {
          if (cancelled) return;
          setLoading(false);
          if (!el) setFailed(true);
        })
        .catch(() => {
          if (cancelled) return;
          setLoading(false);
          setFailed(true);
        });
    };

    render();
    return () => { cancelled = true; };
  }, [tweetId, visible]);

  if (failed) {
    return null;
  }

  return (
    <div ref={containerRef} className="max-w-[550px]">
      {loading && visible && (
        <div className="text-xs text-gray-400 py-2">Loading tweet...</div>
      )}
    </div>
  );
}
