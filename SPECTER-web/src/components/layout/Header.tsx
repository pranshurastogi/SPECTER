import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useApiHealth } from "@/hooks/useApiHealth";
import { api } from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navLinks = [
  { path: "/setup", label: "Setup" },
  { path: "/send", label: "Send" },
  { path: "/scan", label: "Scan" },
  { path: "/yellow", label: "Yellow" },
];

const NavLink = ({
  to,
  children,
  isActive,
}: {
  to: string;
  children: React.ReactNode;
  isActive: boolean;
}) => (
  <Link
    to={to}
    className={`text-sm whitespace-nowrap transition-colors duration-200 ${
      isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {children}
  </Link>
);

export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerShapeClass, setHeaderShapeClass] = useState("rounded-full");
  const shapeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { ok: apiOk, loading: apiLoading } = useApiHealth();

  const toggleMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  useEffect(() => {
    if (shapeTimeoutRef.current) {
      clearTimeout(shapeTimeoutRef.current);
    }

    if (mobileMenuOpen) {
      setHeaderShapeClass("rounded-xl");
    } else {
      shapeTimeoutRef.current = setTimeout(() => {
        setHeaderShapeClass("rounded-full");
      }, 300);
    }

    return () => {
      if (shapeTimeoutRef.current) {
        clearTimeout(shapeTimeoutRef.current);
      }
    };
  }, [mobileMenuOpen]);

  const logoElement = (
    <Link to="/" className="flex items-center gap-2 group">
      <div className="h-6 w-6 flex items-center justify-center">
        <img
          src="/SPECTER-logo.png"
          alt="SPECTER"
          className="size-full scale-125 object-contain"
        />
      </div>
      <span className="font-cursive text-lg sm:text-xl font-medium tracking-wide">
        SPECTER
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
            <span
              className={`inline-flex h-2 w-2 rounded-full shrink-0 ${
                apiLoading
                  ? "bg-muted-foreground"
                  : apiOk
                    ? "bg-green-500"
                    : "bg-destructive"
              }`}
              title="API status"
              aria-label={
                apiLoading
                  ? "Checking API..."
                  : apiOk
                    ? "API connected"
                    : "API unreachable"
              }
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">
              {apiLoading
                ? "Checking API..."
                : apiOk
                  ? "API connected"
                  : "API unreachable"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {api.getBaseUrl()}
            </p>
            {!apiOk && !apiLoading && (
              <p className="text-xs text-muted-foreground mt-1">
                Start backend: cargo run --bin specter -- serve --port 3001
              </p>
            )}
          </TooltipContent>
        </Tooltip>
    </Link>
  );

  return (
    <header
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50
        flex flex-col items-center
        pl-6 pr-6 py-3 backdrop-blur-xl
        ${headerShapeClass}
        border border-border bg-background/60
        w-[calc(100%-2rem)] sm:min-w-[680px] sm:w-auto
        transition-[border-radius] duration-300 ease-in-out`}
    >
      <div className="flex items-center w-full gap-x-6 sm:gap-x-8">
        <div className="flex items-center shrink-0">{logoElement}</div>

        <nav className="flex-1 hidden sm:flex items-center justify-evenly text-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              isActive={location.pathname === link.path}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="w-8 flex justify-end shrink-0">
          <button
            className="sm:hidden flex items-center justify-center w-8 h-8 text-muted-foreground focus:outline-none hover:text-foreground transition-colors"
            onClick={toggleMenu}
            aria-label={mobileMenuOpen ? "Close Menu" : "Open Menu"}
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      <div
        className={`sm:hidden flex flex-col items-center w-full transition-all ease-in-out duration-300 overflow-hidden
          ${mobileMenuOpen ? "max-h-[500px] opacity-100 pt-4" : "max-h-0 opacity-0 pt-0 pointer-events-none"}`}
      >
        <nav className="flex flex-col items-center space-y-4 text-base w-full">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full text-center py-2 transition-colors ${
                location.pathname === link.path
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
