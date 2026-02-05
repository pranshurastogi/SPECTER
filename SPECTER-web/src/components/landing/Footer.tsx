import { Github, Twitter, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function Footer() {
  return (
    <footer className="relative py-10 md:py-12">
      <div className="container mx-auto px-4">
        <div className="glass-card-transparent rounded-2xl p-5 md:p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-2">
              <img src="/SPECTER-logo.png" alt="SPECTER" className="h-6 w-6" />
              <span className="font-display font-bold text-xl md:text-2xl">SPECTER</span>
            </div>

            <nav className="flex items-center gap-5">
              <Link
                to="/"
                className="text-base md:text-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Home
              </Link>
              <Link
                to="/generate"
                className="text-base md:text-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Generate
              </Link>
              <Link
                to="/send"
                className="text-base md:text-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Send
              </Link>
              <Link
                to="/scan"
                className="text-base md:text-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Scan
              </Link>
            </nav>

            <div className="flex items-center gap-4">
              <a
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="GitHub"
              >
                <Github className="h-6 w-6" />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="h-6 w-6" />
              </a>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-base md:text-lg text-muted-foreground">
              © 2026 SPECTER. Post-quantum privacy for everyone.
            </p>
            <Button variant="ghost" size="default" asChild>
              <Link to="/generate" className="gap-2 text-base">
                Get Started
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}
