import { cn } from "@/lib/utils";

export interface HomeLayoutProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Unified home layout: fixed full-viewport background (grid),
 * scrollable content.
 */
export function HomeLayout({ children, className }: HomeLayoutProps) {
  return (
    <div className={cn("min-h-screen relative", className)}>
      <div className="fixed inset-0 z-0 bg-transparent pointer-events-none" aria-hidden />

      <div className="relative z-10 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
