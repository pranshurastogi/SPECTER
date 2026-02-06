import { Github, Twitter } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative py-8 md:py-10">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/SPECTER-logo.png" alt="SPECTER" className="h-5 w-5" />
            <span className="font-display font-bold text-lg">SPECTER</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2026 SPECTER. Post-quantum privacy for everyone.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/pranshurastogi/SPECTER"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="GitHub"
            >
              <Github className="h-5 w-5" />
            </a>
            <a
              href="#"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Twitter"
            >
              <Twitter className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
