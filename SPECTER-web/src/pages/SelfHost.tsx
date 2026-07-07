import { Link } from "react-router-dom";
import {
  Terminal,
  GitBranch,
  Server,
  MonitorSmartphone,
  ShieldQuestion,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent } from "@/components/ui/base/card";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { RecoveryScriptBlock } from "@/components/features/RecoveryScriptBlock";

/** Canonical public repository users clone to run their own SPECTER. */
const REPO_URL = "https://github.com/pranshurastogi/SPECTER.git";

/**
 * A copyable shell snippet. There is no syntax-highlight library in the app (by
 * design — it isn't worth the bundle for a few shell lines), so this reuses the
 * established `font-mono` code-display pattern with the shared `CopyButton`.
 */
function CommandBlock({ commands }: { commands: string[] }) {
  const text = commands.join("\n");
  return (
    <div className="relative group">
      <pre className="text-xs font-mono leading-relaxed block bg-background/80 p-3 pr-12 rounded-lg border border-white/[0.08] overflow-x-auto">
        <code>
          {commands.map((line) => (
            <span key={line} className="block">
              <span className="select-none text-muted-foreground/60">$ </span>
              {line}
            </span>
          ))}
        </code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton
          text={text}
          showLabel={false}
          variant="ghost"
          size="icon"
          successMessage="Command copied"
          tooltip="Copy command"
        />
      </div>
    </div>
  );
}

/** One numbered step: badge + heading + optional blurb + commands + env note. */
function Step({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
          {n}
        </div>
        <div className="w-px flex-1 bg-white/[0.08] mt-2" />
      </div>
      <div className="flex-1 min-w-0 pb-8 space-y-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="font-display font-semibold text-foreground">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A key=value env hint row. */
function EnvVars({ vars }: { vars: [string, string][] }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3 space-y-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
        Key variables
      </p>
      {vars.map(([k, v]) => (
        <div key={k} className="text-[11px] font-mono break-all">
          <span className="text-foreground">{k}</span>
          <span className="text-muted-foreground">={v}</span>
        </div>
      ))}
    </div>
  );
}

export default function SelfHost() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
        <div className="w-full max-w-2xl mx-auto px-4">
          {/* Explainer */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 mb-4">
              <Terminal className="h-6 w-6 text-primary" />
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Self-host SPECTER
            </h1>
            <p className="text-sm text-muted-foreground mt-3">
              SPECTER is open source. If the hosted app is ever down — or you simply don't want to
              trust ours — clone the repository and run the whole stack yourself. The web app and the
              Rust backend below are the exact same code that powers the hosted service.
            </p>
          </div>

          {/* Recovery-only shortcut: the reason this page exists. */}
          <div className="mb-8 p-4 rounded-xl bg-primary/[0.06] border border-primary/20 flex items-start gap-3">
            <ShieldQuestion className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <span className="text-foreground font-medium">Just need your funds back?</span> You
              don't have to run the backend. Do Step&nbsp;1 and Step&nbsp;3, then open{" "}
              <Link to="/i-dont-trust-specter" className="text-primary hover:underline">
                /i-dont-trust-specter
              </Link>{" "}
              on your local copy — recovery runs entirely in your browser against a public Monad RPC,
              with zero SPECTER calls.
            </div>
          </div>

          {/* Lightest path: just want your funds back? One file, two deps. */}
          <RecoveryScriptBlock />

          <Card className="mt-6 w-full border-border bg-card/50 shadow-lg rounded-xl">
            <CardContent className="p-5 md:p-6">
              {/* Step 1 — Clone */}
              <Step n={1} icon={GitBranch} title="Clone the repository">
                <p className="text-sm text-muted-foreground">
                  You'll need <span className="text-foreground">git</span>,{" "}
                  <span className="text-foreground">Node.js ≥ 18</span>, and a{" "}
                  <span className="text-foreground">stable Rust toolchain</span> installed.
                </p>
                <CommandBlock
                  commands={[`git clone ${REPO_URL}`, "cd SPECTER"]}
                />
              </Step>

              {/* Step 2 — Backend */}
              <Step n={2} icon={Server} title="Run the backend (Rust API)">
                <p className="text-sm text-muted-foreground">
                  The Axum API serves public data — the announcement registry, ENS/SuiNS resolution,
                  IPFS pinning and the gas-sponsored relayer. It never sees your secret keys.
                </p>
                <CommandBlock
                  commands={[
                    "cd specter",
                    "cp .env.example .env",
                    "cargo run -p specter-cli -- serve --port 3001",
                  ]}
                />
                <EnvVars
                  vars={[
                    ["ETH_RPC_URL", "<your Ethereum RPC>"],
                    ["MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"],
                    ["PINATA_JWT", "<Pinata / IPFS token>"],
                    ["REGISTRY_BACKEND", "turso  # or leave unset for in-memory"],
                    ["SPECTER_ANNOUNCER_ADDRESS", "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC"],
                  ]}
                />
              </Step>

              {/* Step 3 — Frontend */}
              <Step n={3} icon={MonitorSmartphone} title="Run the web app">
                <p className="text-sm text-muted-foreground">
                  The React front end — including the recovery tool. Point{" "}
                  <span className="font-mono text-xs text-foreground">VITE_API_BASE_URL</span> at the
                  backend from Step&nbsp;2 (or leave the default for the hosted one).
                </p>
                <CommandBlock
                  commands={[
                    "cd SPECTER-web",
                    "cp .env.example .env",
                    "npm install",
                    "npm run dev",
                  ]}
                />
                <EnvVars
                  vars={[
                    ["VITE_API_BASE_URL", "http://localhost:3001"],
                    ["VITE_DYNAMIC_ENVIRONMENT_ID", "<Dynamic.xyz env id>"],
                    ["VITE_MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz"],
                    ["VITE_SPECTER_ANNOUNCER_ADDRESS", "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC"],
                  ]}
                />
              </Step>

              {/* Done — no trailing connector line */}
              <div className="flex gap-4">
                <div className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-success/10 border border-success/20 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h2 className="font-display font-semibold text-foreground">
                    Open your instance
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    The dev server prints its URL —{" "}
                    <span className="font-mono text-xs text-foreground">
                      http://localhost:8080
                    </span>
                    . Everything now runs on your machine. To recover funds, head to{" "}
                    <span className="font-mono text-xs text-foreground">
                      /i-dont-trust-specter
                    </span>
                    .
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Footer links */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <a
              href="https://github.com/pranshurastogi/SPECTER"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <GitBranch className="h-3.5 w-3.5" />
              View source on GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              to="/i-dont-trust-specter"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ShieldQuestion className="h-3.5 w-3.5" />
              Recover without SPECTER
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
