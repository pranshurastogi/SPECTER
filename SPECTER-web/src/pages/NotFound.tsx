import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { HeadingScramble } from "@/components/ui/heading-scramble";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-panel rounded-2xl p-10 text-center max-w-md">
        <HeadingScramble
          as="h1"
          className="font-display mb-3 text-4xl font-bold block"
        >
          404
        </HeadingScramble>
        <p className="mb-6 text-muted-foreground">Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90 text-sm">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
