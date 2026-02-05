import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Menu, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { formatAddress } from "@/lib/utils";
import { useApiHealth } from "@/hooks/useApiHealth";
import { api } from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navLinks = [
  { path: "/", label: "Home" },
  { path: "/generate", label: "Generate Keys" },
  { path: "/send", label: "Send" },
  { path: "/scan", label: "Scan" },
  { path: "/ens", label: "ENS" },
];

export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { ok: apiOk, loading: apiLoading } = useApiHealth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-panel rounded-none border-b border-border/50 border-t-0 border-x-0">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo + API status */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 group">
              <motion.div
                className="relative"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <img src="/SPECTER-logo.png" alt="SPECTER" className="h-10 w-10" />
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              </motion.div>
              <span className="font-display font-bold text-2xl tracking-tight">
                SPECTER
              </span>
            </Link>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex h-2 w-2 rounded-full shrink-0 ${apiLoading
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
            </TooltipProvider>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="relative px-4 py-2"
              >
                <span
                  className={`font-medium text-sm transition-colors ${location.pathname === link.path
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {link.label}
                </span>
                {location.pathname === link.path && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-primary/10 rounded-lg border border-primary/20"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </Link>
            ))}
          </nav>

          {/* CTA & Wallet */}
          <div className="hidden md:flex items-center gap-3">
            {isConnected ? (
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono text-primary">
                      {formatAddress(address)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnect()}
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <>
                <Button
                  variant="quantum"
                  size="sm"
                  onClick={() => connect({ connector: connectors[0] })}
                  disabled={isPending}
                >
                  {isPending ? (
                    "Connecting..."
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      Connect Wallet
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/generate">Get Started</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="md:hidden absolute top-16 left-0 right-0 bg-background border-b border-border"
        >
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-4 py-3 rounded-lg font-medium transition-colors ${location.pathname === link.path
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted"
                  }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-border/50">
              {isConnected ? (
                <div className="px-4 py-3 space-y-2">
                  <div className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      <span className="text-sm font-mono text-primary">
                        {formatAddress(address)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      disconnect();
                      setMobileMenuOpen(false);
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  variant="quantum"
                  size="sm"
                  className="w-full mx-4"
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
                      <Wallet className="h-4 w-4" />
                      Connect Wallet
                    </>
                  )}
                </Button>
              )}
            </div>
          </nav>
        </motion.div>
      )}
    </header>
  );
}
