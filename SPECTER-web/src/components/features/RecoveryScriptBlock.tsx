import { useState } from "react";
import { Terminal, ChevronDown, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { RECOVERY_INSTALL, RECOVERY_SCRIPT } from "@/lib/recovery/recoveryScript";

/**
 * The self-runnable, headless recovery script — the exact logic behind the
 * on-page "Recover my funds" button, shown so the user can read and run it
 * themselves. Rendered on both `/i-dont-trust-specter` and `/self-host` from a
 * single source of truth (`recoveryScript.ts`) so the two copies never drift.
 *
 * No new dependency: reuses the shared `CopyButton` and the established
 * `$`-prefixed `<pre>` code pattern; the script body is a collapsible disclosure
 * (mirrors the "Monad RPC endpoint" toggle on the recovery page) so ~90 lines of
 * code don't crowd the page until asked for.
 */
export function RecoveryScriptBlock() {
  const [open, setOpen] = useState(false);
  const installText = RECOVERY_INSTALL.join("\n");

  return (
    <div className="mt-6 rounded-xl border border-white/[0.08] bg-card/30 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-primary" />
        <h2 className="font-display font-semibold text-foreground text-sm">
          Prefer a script? Run recovery headless.
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        This is the same cryptography this page runs — ML-KEM-768 decapsulation and stealth-key
        derivation via the <span className="font-mono text-foreground">@specterpq/sdk</span> WASM,
        with zero SPECTER calls. Two dependencies, one file. Your keys never leave your machine.
      </p>

      {/* Setup commands */}
      <div className="relative">
        <pre className="text-[11px] font-mono leading-relaxed block bg-background/80 p-3 pr-12 rounded-lg border border-white/[0.08] overflow-x-auto">
          <code>
            {RECOVERY_INSTALL.map((line) => (
              <span key={line} className="block">
                <span className="select-none text-muted-foreground/60">$ </span>
                {line}
              </span>
            ))}
          </code>
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton
            text={installText}
            showLabel={false}
            variant="ghost"
            size="icon"
            successMessage="Commands copied"
            tooltip="Copy commands"
          />
        </div>
      </div>

      {/* Collapsible script body */}
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>{open ? "Hide" : "Show"} recover.mjs</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="relative mt-2">
            <pre className="text-[11px] font-mono leading-relaxed block bg-background/80 p-3 pr-12 rounded-lg border border-white/[0.08] overflow-x-auto max-h-[28rem] overflow-y-auto">
              <code>{RECOVERY_SCRIPT}</code>
            </pre>
            <div className="absolute top-1.5 right-1.5">
              <CopyButton
                text={RECOVERY_SCRIPT}
                showLabel={false}
                variant="ghost"
                size="icon"
                successMessage="Script copied"
                tooltip="Copy recover.mjs"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground/80">
        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
        <span>
          Each recovered key is re-checked against its address before it's printed — if the private
          key doesn't control the funds, the script says so.
        </span>
      </div>
    </div>
  );
}
