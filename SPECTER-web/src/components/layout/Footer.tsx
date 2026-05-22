import { Link } from "react-router-dom";
import { Github, BookOpen, MonitorPlay, Rss } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { XLogo } from "@/components/features/insights/XLogo";
import { getAppDeployment } from "@/lib/appEnv";
import { cn } from "@/lib/utils";

/** npm brand mark (Simple Icons), inherits `currentColor` for theme consistency */
function NpmLogo({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path
        fill="currentColor"
        d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.832h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
      />
    </svg>
  );
}

const devLinkClass =
  "flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors";

export function Footer() {
  const deployment = getAppDeployment();
  const isStaging = deployment === "staging";
  const socialLinks = [
    {
      icon: <XLogo className="h-4 w-4" />,
      href: "https://x.com/specter_PQ",
      label: "X (formerly Twitter)",
    },
    {
      icon: <Github className="h-5 w-5" />,
      href: "https://github.com/pranshurastogi/SPECTER",
      label: "GitHub",
    },
  ];

  return (
    <footer className="pb-6 pt-16 lg:pb-8 lg:pt-24">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="md:flex md:items-start md:justify-between">
          <div className="flex flex-col gap-4">
            <Link
              to="/"
              className="flex items-center gap-x-2"
              aria-label="SPECTER"
            >
              <div className="h-6 w-6 flex items-center justify-center">
                <img
                  src="/Specterpq-dark.png"
                  alt=""
                  className="size-full scale-125 object-contain"
                  aria-hidden
                />
              </div>
              <span className="font-cursive text-lg sm:text-xl font-medium tracking-wide">
                SPECTER
              </span>
            </Link>
            <a
              href="https://docs.specterpq.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={devLinkClass}
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              <span>Documentation</span>
            </a>
            <Link to="/insights" className={devLinkClass}>
              <Rss className="h-4 w-4 shrink-0" />
              <span>Insights</span>
            </Link>
          </div>
          <div className="flex flex-col gap-4 mt-6 md:mt-0 md:items-end">
            <ul className="flex list-none gap-3 md:justify-end">
              {socialLinks.map((link, i) => (
                <li key={i}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    asChild
                  >
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                    >
                      {link.icon}
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 w-full md:w-auto md:items-end">
              <a
                href="https://www.npmjs.com/package/@specterpq/sdk"
                target="_blank"
                rel="noopener noreferrer"
                className={devLinkClass}
              >
                <NpmLogo className="h-4 w-4" />
                <span>@specterpq/sdk</span>
              </a>
              <a
                href="https://play.specterpq.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={devLinkClass}
              >
                <MonitorPlay className="h-4 w-4 shrink-0" />
                <span>Playground</span>
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-border mt-6 pt-6 md:mt-4 md:pt-8 flex items-center justify-between flex-wrap gap-3">
          {/* Live protocol status */}
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="font-display text-[10px] font-semibold tracking-[0.22em] uppercase text-muted-foreground/40 select-none">
              Specter Protocol · Quantum&#8209;Safe · © 2026
            </span>
            {isStaging && (
              <span
                className="font-display text-[9px] font-bold tracking-[0.18em] uppercase px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400/70"
                aria-label="Staging deployment"
              >
                staging
              </span>
            )}
          </div>

          {/* Cipher flavour text — rotates on each render is too much; static is cleaner */}
          <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/20 select-none hidden sm:block">
            [TRANSMISSIONS ENCRYPTED]
          </span>
        </div>
      </div>
    </footer>
  );
}
