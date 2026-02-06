import { Link, useLocation } from "react-router-dom";
import { Menu, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { formatAddress } from "@/lib/utils";
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
  { path: "/ens", label: "ENS" },
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
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
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
      <div className="h-14 w-14 sm:h-14 sm:w-14 shrink-0 overflow-hidden flex items-center justify-center">
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

  const walletElement = (
    <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
      {isConnected ? (
        <>
          <div className="px-3 py-1.5 rounded-full border border-border bg-background/60 text-muted-foreground text-xs sm:text-sm w-full sm:w-auto flex justify-center">
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-primary">{formatAddress(address)}</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full h-8 px-3 text-xs sm:text-sm border-border bg-background/60 hover:border-foreground/30 w-full sm:w-auto"
            onClick={() => {
              disconnect();
              setMobileMenuOpen(false);
            }}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full h-8 px-3 text-xs sm:text-sm border-border bg-background/60 hover:border-foreground/30 w-full sm:w-auto"
          onClick={() => {
            connect({ connector: connectors[0] });
            setMobileMenuOpen(false);
          }}
          disabled={isPending}
        >
          {isPending ? (
            "Connecting..."
          ) : (
            <>
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              Connect Wallet
            </>
          )}
        </Button>
      )}
    </div>
  );

  return (
    <header
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50
        flex flex-col items-center
        pl-6 pr-6 py-3 backdrop-blur-xl
        ${headerShapeClass}
        border border-border bg-background/60
        w-[calc(100%-2rem)] sm:w-auto
        transition-[border-radius] duration-300 ease-in-out`}
    >
      <div className="flex items-center justify-between w-full gap-x-6 sm:gap-x-8">
        <div className="flex items-center">{logoElement}</div>

        <nav className="hidden sm:flex items-center gap-4 sm:gap-6 text-sm shrink-0">
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

        <div className="hidden sm:flex items-center gap-2 sm:gap-3">
          {walletElement}
        </div>

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
        <div className="flex flex-col items-center space-y-3 mt-4 w-full">
          {walletElement}
        </div>
      </div>
    </header>
  );
}
