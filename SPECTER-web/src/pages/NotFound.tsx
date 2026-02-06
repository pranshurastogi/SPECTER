import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center pt-20 pb-12 px-4">
        <div className="glass-panel rounded-2xl p-10 text-center max-w-md">
          <HeadingScramble
            as="h1"
            className="font-display mb-3 text-4xl font-bold block"
          >
            404
          </HeadingScramble>
          <p className="mb-6 text-muted-foreground">Page not found</p>
          <Link to="/" className="text-primary underline hover:text-primary/90 text-sm">
            Return to Home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
