import { useState } from "react";
import { TextScramble } from "@/components/ui/text-scramble";

export type HeadingScrambleProps = {
  children: string;
  as?: "h1" | "h2" | "h3" | "h4";
  className?: string;
  duration?: number;
  speed?: number;
  /** When set, parent controls when to scramble (e.g. from a wrapper's onMouseEnter). */
  trigger?: number;
};

/**
 * Main heading with scramble-on-hover animation. Use for page titles and section headings.
 */
export function HeadingScramble({
  children,
  as = "h1",
  className,
  duration = 1.2,
  speed = 0.03,
  trigger: controlledTrigger,
}: HeadingScrambleProps) {
  const [internalTrigger, setInternalTrigger] = useState(0);
  const trigger = controlledTrigger ?? internalTrigger;

  const content = (
    <TextScramble
      as={as}
      className={className}
      duration={duration}
      speed={speed}
      trigger={trigger}
    >
      {children}
    </TextScramble>
  );

  if (controlledTrigger !== undefined) {
    return content;
  }

  return (
    <div
      className="cursor-default inline-block"
      onMouseEnter={() => setInternalTrigger((t) => t + 1)}
    >
      {content}
    </div>
  );
}
