import {
  useScroll,
  useTransform,
  motion,
} from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HeadingScramble } from "@/components/ui/heading-scramble";

export interface TimelineEntry {
  title: string;
  content: React.ReactNode;
}

export interface TimelineProps {
  data: TimelineEntry[];
  title?: string;
  subtitle?: string;
  className?: string;
  /** Line gradient from (e.g. primary) to transparent */
  lineFrom?: string;
}

export function Timeline({
  data,
  title,
  subtitle,
  className,
  lineFrom = "from-primary via-primary/50",
}: TimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setHeight(rect.height);
    }
    const ro = new ResizeObserver(() => {
      if (ref.current) {
        setHeight(ref.current.getBoundingClientRect().height);
      }
    });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [data.length]);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 10%", "end 50%"],
  });

  const heightTransform = useTransform(scrollYProgress, [0, 1], [0, height]);
  const opacityTransform = useTransform(scrollYProgress, [0, 0.1], [0, 1]);

  return (
    <div
      className={cn("w-full bg-transparent font-sans md:px-10", className)}
      ref={containerRef}
    >
      <div className="max-w-7xl mx-auto py-8 md:py-10 px-4 md:px-6 lg:px-8">
        {title != null && (
          <HeadingScramble
            as="h2"
            className="font-display text-3xl md:text-5xl lg:text-6xl font-bold text-foreground max-w-4xl block"
          >
            {title}
          </HeadingScramble>
        )}
        {subtitle != null && (
          <p className="text-muted-foreground text-lg md:text-xl lg:text-2xl mt-4 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>

      <div ref={ref} className="relative max-w-7xl mx-auto pb-12">
        {data.map((item, index) => (
          <div
            key={index}
            className="flex justify-start pt-6 md:pt-16 md:gap-8"
          >
            <div className="sticky flex flex-col md:flex-row z-40 items-center top-28 self-start max-w-xs lg:max-w-sm md:w-full">
              <div className="h-9 absolute left-3 md:left-3 w-9 rounded-full bg-background/80 dark:bg-background/80 backdrop-blur-xl border border-border flex items-center justify-center ring-2 ring-primary/20">
                <div className="h-3 w-3 rounded-full bg-primary/20 border border-primary/40" />
              </div>
              <HeadingScramble
                as="h3"
                className="hidden md:block font-display text-2xl md:pl-16 md:text-4xl lg:text-5xl font-bold text-muted-foreground"
              >
                {item.title}
              </HeadingScramble>
            </div>

            <div className="relative pl-16 pr-4 md:pl-4 w-full">
              <HeadingScramble
                as="h3"
                className="md:hidden block font-display text-2xl lg:text-3xl mb-3 text-left font-bold text-muted-foreground"
              >
                {item.title}
              </HeadingScramble>
              <div className="text-foreground">{item.content}</div>
            </div>
          </div>
        ))}
        <div
          style={{ height: height + "px" }}
          className={cn(
            "absolute md:left-6 left-6 top-0 overflow-hidden w-[2px]",
            "bg-gradient-to-b from-transparent from-[0%] via-border to-transparent to-[99%]",
            "[mask-image:linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)]"
          )}
        >
          <motion.div
            style={{
              height: heightTransform,
              opacity: opacityTransform,
            }}
            className={cn(
              "absolute inset-x-0 top-0 w-[2px] rounded-full",
              "bg-gradient-to-t from-primary via-primary/50 to-transparent"
            )}
          />
        </div>
      </div>
    </div>
  );
}
