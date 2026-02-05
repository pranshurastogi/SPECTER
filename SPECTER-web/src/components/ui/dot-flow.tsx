import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

export type DotFlowProps = {
  items: {
    title: string;
    frames: number[][];
    duration?: number;
    repeatCount?: number;
  }[];
  /** Theme-aligned: glass card style, primary dots, foreground text */
  className?: string;
};

export const DotFlow = ({ items, className }: DotFlowProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [textIndex, setTextIndex] = useState(0);

  const { contextSafe } = useGSAP();

  if (!items.length) return null;
  const currentItem = items[index];
  const currentTextItem = items[textIndex];
  if (!currentItem || !currentTextItem) return null;

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;

    const newWidth = textRef.current.offsetWidth + 1;

    gsap.to(containerRef.current, {
      width: newWidth,
      duration: 0.5,
      ease: "power2.out",
    });
  }, [textIndex]);

  const next = contextSafe(() => {
    const el = containerRef.current;
    if (!el) return;
    gsap.to(el, {
      y: 20,
      opacity: 0,
      filter: "blur(8px)",
      duration: 0.5,
      ease: "power2.in",
      onComplete: () => {
        setTextIndex((prev) => (prev + 1) % items.length);
        gsap.fromTo(
          el,
          { y: -20, opacity: 0, filter: "blur(4px)" },
          {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.7,
            ease: "power2.out",
          },
        );
      },
    });

    setIndex((prev) => (prev + 1) % items.length);
  });

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 shadow-sm",
        "text-foreground",
        className,
      )}
    >
      <DotLoader
        frames={currentItem.frames}
        onComplete={next}
        className="gap-px"
        repeatCount={currentItem.repeatCount ?? 1}
        duration={currentItem.duration ?? 150}
        dotClassName="bg-muted-foreground/25 [&.active]:bg-primary h-1.5 w-1.5 rounded-sm"
      />
      <div ref={containerRef} className="relative overflow-hidden">
        <div
          ref={textRef}
          className="inline-block whitespace-nowrap text-lg font-medium text-foreground"
        >
          {currentTextItem.title}
        </div>
      </div>
    </div>
  );
};
