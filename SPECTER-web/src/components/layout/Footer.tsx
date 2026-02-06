import { Link } from "react-router-dom";
import { X, Github } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Footer() {
  const socialLinks = [
    {
      icon: <X className="h-5 w-5" />,
      href: "https://x.com",
      label: "X (Twitter)",
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
          <Link
            to="/"
            className="flex items-center gap-x-2"
            aria-label="SPECTER"
          >
            <div className="h-6 w-6 flex items-center justify-center">
              <img
                src="/SPECTER-logo.png"
                alt=""
                className="size-full scale-125 object-contain"
                aria-hidden
              />
            </div>
            <span className="font-cursive text-lg sm:text-xl font-medium tracking-wide">
              SPECTER
            </span>
          </Link>
          <ul className="flex list-none mt-6 md:mt-0 gap-3">
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
        </div>
        <div className="border-t border-border mt-6 pt-6 md:mt-4 md:pt-8">
          <div className="mt-6 text-sm leading-6 text-muted-foreground lg:mt-0">
            © 2026. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
