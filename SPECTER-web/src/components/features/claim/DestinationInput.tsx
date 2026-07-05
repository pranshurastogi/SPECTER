/**
 * Step 2 of the claim flow: where should the funds go? One input that
 * accepts a 0x address or an ENS name. Resolution happens automatically as
 * the user types (debounced for ENS lookups), so the only button is Continue.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { resolveDestination, type ResolvedDestination } from "@/lib/claim/destination";

interface DestinationInputProps {
  /** Lowercased stealth addresses owned by this identity (self-send guard). */
  ownStealthAddresses: Set<string>;
  onConfirm: (dest: ResolvedDestination) => void;
}

/** Full 0x addresses validate instantly; everything else (ENS) waits a beat. */
const looksLikeFullAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const looksLikeEns = (v: string) => /^[^\s]+\.[a-z]{2,}$/i.test(v.trim());

export function DestinationInput({ ownStealthAddresses, onConfirm }: DestinationInputProps) {
  const [value, setValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedDestination | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order async results while the user keeps typing.
  const requestSeq = useRef(0);

  const isOwnStealth =
    resolved !== null && ownStealthAddresses.has(resolved.address.toLowerCase());

  useEffect(() => {
    const input = value.trim();
    setResolved(null);
    setError(null);
    if (!input || (!looksLikeFullAddress(input) && !looksLikeEns(input))) {
      setResolving(false);
      return;
    }

    const seq = ++requestSeq.current;
    const run = async () => {
      setResolving(true);
      try {
        const dest = await resolveDestination(input);
        if (requestSeq.current === seq) setResolved(dest);
      } catch (err) {
        if (requestSeq.current === seq) {
          setError(err instanceof Error ? err.message : "Could not resolve destination");
        }
      } finally {
        if (requestSeq.current === seq) setResolving(false);
      }
    };

    // Addresses are checked locally — instant. ENS needs a network lookup, so
    // wait for the user to pause typing.
    const delay = looksLikeFullAddress(input) ? 0 : 500;
    const t = window.setTimeout(run, delay);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The wallet that should receive the funds — an address or an ENS name.
      </p>
      <div className="relative">
        <Input
          placeholder="0x… or alice.eth"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && resolved && !isOwnStealth) onConfirm(resolved);
          }}
          className="font-mono text-xs pr-9"
          autoFocus
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {resolving ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
          ) : resolved && !isOwnStealth ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : null}
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-lg border text-xs bg-destructive/10 border-destructive/30 text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {resolved && resolved.kind === "ens" && (
        <div className="specter-confirm">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="specter-confirm-text">
            {resolved.input} → <code className="font-mono">{resolved.address}</code>
          </span>
        </div>
      )}

      {isOwnStealth && (
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            This is one of your own stealth addresses. Claiming into it would
            just move funds between stealth addresses — pick the wallet you
            actually control day-to-day.
          </p>
        </div>
      )}

      <div className="pt-1">
        <Button
          variant="quantum"
          className="w-full"
          disabled={!resolved || isOwnStealth}
          onClick={() => resolved && onConfirm(resolved)}
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
