"use client";

import React, {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
} from "react";
import { cn } from "@/lib/utils";

const DefaultHomeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const DefaultCompassIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />
  </svg>
);

const DefaultBellIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export type NavItem = {
  id: string | number;
  icon: React.ReactElement;
  label?: string;
  onClick?: () => void;
};

const defaultNavItems: NavItem[] = [
  { id: "default-home", icon: <DefaultHomeIcon />, label: "Home" },
  { id: "default-explore", icon: <DefaultCompassIcon />, label: "Explore" },
  { id: "default-notifications", icon: <DefaultBellIcon />, label: "Notifications" },
];

type LimelightNavProps = {
  items?: NavItem[];
  defaultActiveIndex?: number;
  activeIndex?: number;
  onTabChange?: (index: number) => void;
  className?: string;
  limelightClassName?: string;
  iconContainerClassName?: string;
  iconClassName?: string;
};

export const LimelightNav = ({
  items = defaultNavItems,
  defaultActiveIndex = 0,
  activeIndex,
  onTabChange,
  className,
  limelightClassName,
  iconContainerClassName,
  iconClassName,
}: LimelightNavProps) => {
  const [internalActiveIndex, setInternalActiveIndex] = useState(defaultActiveIndex);
  const [isReady, setIsReady] = useState(false);

  const resolvedActiveIndex = activeIndex ?? internalActiveIndex;
  const navItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const limelightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof activeIndex === "number") {
      setInternalActiveIndex(activeIndex);
    }
  }, [activeIndex]);

  useLayoutEffect(() => {
    if (items.length === 0) return;

    const limelight = limelightRef.current;
    const activeItem = navItemRefs.current[resolvedActiveIndex];

    if (limelight && activeItem) {
      const newLeft =
        activeItem.offsetLeft + activeItem.offsetWidth / 2 - limelight.offsetWidth / 2;
      limelight.style.left = `${newLeft}px`;

      if (!isReady) {
        setTimeout(() => setIsReady(true), 50);
      }
    }
  }, [resolvedActiveIndex, isReady, items]);

  if (items.length === 0) {
    return null;
  }

  const handleItemClick = (index: number, itemOnClick?: () => void) => {
    setInternalActiveIndex(index);
    onTabChange?.(index);
    itemOnClick?.();
  };

  return (
    <nav
      className={cn(
        "relative inline-flex max-w-full items-center rounded-lg border border-zinc-800 bg-card/90 px-2 text-foreground",
        className
      )}
    >
      {items.map(({ id, icon, label, onClick }, index) => (
        <button
          key={id}
          ref={(el) => (navItemRefs.current[index] = el)}
          type="button"
          className={cn(
            "relative z-20 flex h-14 cursor-pointer items-center justify-center px-3 sm:px-4",
            iconContainerClassName
          )}
          onClick={() => handleItemClick(index, onClick)}
          aria-label={label}
          title={label}
        >
          {cloneElement(icon, {
            className: cn(
              "h-5 w-5 transition-opacity duration-100 ease-in-out",
              resolvedActiveIndex === index ? "opacity-100" : "opacity-45",
              icon.props.className,
              iconClassName
            ),
          })}
        </button>
      ))}

      <div
        ref={limelightRef}
        className={cn(
          "absolute top-0 z-10 h-[5px] w-11 rounded-full bg-primary shadow-[0_40px_14px_hsl(var(--primary)/0.55)]",
          isReady ? "transition-[left] duration-300 ease-in-out" : "",
          limelightClassName
        )}
        style={{ left: "-999px" }}
      >
        <div className="pointer-events-none absolute left-[-30%] top-[5px] h-12 w-[160%] [clip-path:polygon(5%_100%,25%_0,75%_0,95%_100%)] bg-gradient-to-b from-primary/25 to-transparent" />
      </div>
    </nav>
  );
};
