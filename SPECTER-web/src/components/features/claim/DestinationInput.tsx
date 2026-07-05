/**
 * Step 2 of the claim flow: where should the funds go? One input that
 * accepts a 0x address or an ENS name, resolved before the user can
 * continue so there are no surprises at confirm time.
 */
import { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { resolveDestination, type ResolvedDestination } from "@/lib/claim/destination";

interface DestinationInputProps {
  /** Lowercased stealth addresses owned by this identity (self-send guard). */
  ownStealthAddresses: Set<string>;
  onConfirm: (dest: ResolvedDestination) => void;
  onBack: () => void;
}

export function DestinationInput({
  ownStealthAddresses,
  onConfirm,
  onBack,
}: DestinationInputProps) {
  const [value, setValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedDestination | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwnStealth =
    resolved !== null && ownStealthAddresses.has(resolved.address.toLowerCase());

  const handleResolve = async () => {
    setResolving(true);
    setError(null);
    setResolved(null);
    try {
      const dest = await resolveDestination(value);
      setResolved(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve destination");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Enter the wallet that should receive the funds — an address or an ENS
        name.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="0x… or alice.eth"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResolved(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !resolving) handleResolve();
          }}
          className="font-mono text-xs flex-1"
          autoFocus
        />
        <Button
          variant="outline"
          onClick={handleResolve}
          disabled={!value.trim() || resolving}
        >
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border text-xs bg-destructive/10 border-destructive/30 text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {resolved && (
        <div className="specter-confirm">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="specter-confirm-text">
            {resolved.kind === "ens" ? (
              <>
                {resolved.input} → <code className="font-mono">{resolved.address}</code>
              </>
            ) : (
              <>Valid address</>
            )}
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

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="quantum"
          className="flex-1"
          disabled={!resolved || isOwnStealth}
          onClick={() => resolved && onConfirm(resolved)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
