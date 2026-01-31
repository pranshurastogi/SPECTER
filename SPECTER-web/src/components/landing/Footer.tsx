import { Github, Twitter } from "lucide-react";
import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="py-12 border-t border-border/50">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img src="/SPECTER-logo.png" alt="SPECTER" className="h-6 w-6" />
            <span className="font-display font-bold text-lg">SPECTER</span>
          </div>

          {/* Links */}
          <nav className="flex items-center gap-6">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Home
            </Link>
            <Link
              to="/generate"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Generate
            </Link>
            <Link
              to="/send"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Send
            </Link>
            <Link
              to="/scan"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Scan
            </Link>
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="h-5 w-5" />
            </a>
            <a
              href="#"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Twitter className="h-5 w-5" />
            </a>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border/50 text-center">
          <p className="text-sm text-muted-foreground">
            © 2026 SPECTER. Post-quantum privacy for everyone.
          </p>
        </div>
      </div>
    </footer>
  );
}
