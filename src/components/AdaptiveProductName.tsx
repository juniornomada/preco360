import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type AdaptiveProductNameProps = {
  text: string;
  className?: string;
  minPx?: number;
  maxPx?: number;
  desktopMaxPx?: number;
};

export default function AdaptiveProductName({
  text,
  className,
  minPx = 11,
  maxPx = 15,
  desktopMaxPx = 16,
}: AdaptiveProductNameProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;

    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = ref.current;
        if (!node || node.clientWidth <= 0) return;

        const upperLimit =
          window.matchMedia("(min-width: 640px)").matches
            ? desktopMaxPx
            : maxPx;

        let low = minPx;
        let high = upperLimit;
        let best = minPx;

        // Binary search for the largest font that fits the real available width.
        for (let step = 0; step < 7; step += 1) {
          const candidate = (low + high) / 2;
          node.style.fontSize = `${candidate}px`;

          if (node.scrollWidth <= node.clientWidth + 0.5) {
            best = candidate;
            low = candidate;
          } else {
            high = candidate;
          }
        }

        node.style.fontSize = `${Math.max(minPx, Math.min(best, upperLimit)).toFixed(2)}px`;
      });
    };

    fit();

    const observer = new ResizeObserver(fit);
    if (element.parentElement) observer.observe(element.parentElement);

    const fontSet = document.fonts;
    void fontSet?.ready.then(fit);

    window.addEventListener("orientationchange", fit);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, [text, minPx, maxPx, desktopMaxPx]);

  return (
    <span
      ref={ref}
      className={cn(
        "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[1.22]",
        className,
      )}
      title={text}
    >
      {text}
    </span>
  );
}
