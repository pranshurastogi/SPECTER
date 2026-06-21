import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ErrorScreen } from "@/components/features/ErrorScreen";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center pt-28 pb-16 px-4">
        <ErrorScreen
          errorCode="404"
          screenMessage="NOT FOUND"
          title="Lost in the static"
          description="This page must be a ghost — we couldn't tune it in. Let's get you back to a working channel."
          actions={
            <Link
              to="/"
              className="font-dm-sans inline-block select-none rounded-full bg-primary px-8 py-3 text-lg font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Go to Home
            </Link>
          }
        />
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
