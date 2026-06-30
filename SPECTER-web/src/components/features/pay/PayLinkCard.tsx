import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Link2,
  QrCode as QrIcon,
  Share2,
  Download,
  Wallet,
  Loader2,
  UserPlus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/base/card";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Badge } from "@/components/ui/base/badge";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { QrCode, downloadQrPng } from "@/components/ui/specialized/qr-code";
import { RequestPaymentDrawer } from "./RequestPaymentDrawer";
import { getRegisteredName } from "@/lib/setupProgress";
import { buildPayUrl, isValidRecipientName } from "@/lib/payLink";
import { api, ApiError } from "@/lib/api";
import { analytics } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Verification state of the receiver's name against the SPECTER registry. */
type VerifyStatus = "idle" | "invalid" | "checking" | "registered" | "unregistered" | "error";

/** API error codes that mean "this name has no SPECTER record yet" (vs a transient failure). */
const NOT_REGISTERED_CODES = new Set([
  "NO_SPECTER_RECORD",
  "NO_SUINS_SPECTER_RECORD",
  "ENS_NAME_NOT_FOUND",
  "SUINS_NAME_NOT_FOUND",
]);

const VERIFY_DEBOUNCE_MS = 600;

export function PayLinkCard({ source, className }: { source: "scan" | "setup"; className?: string }) {
  // A stored name comes from a completed setup, so it's already known-registered.
  const storedName = useMemo(() => getRegisteredName(), []);
  const isManualEntry = !storedName;

  const [name, setName] = useState<string>(storedName ?? "");
  const [status, setStatus] = useState<VerifyStatus>(storedName ? "registered" : "idle");
  const [showQr, setShowQr] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reqId = useRef(0);

  const url = useMemo(
    () => (status === "registered" && isValidRecipientName(name.toLowerCase()) ? buildPayUrl(name.toLowerCase()) : ""),
    [status, name]
  );

  useEffect(() => {
    analytics.payLinkCardViewed(source);
  }, [source]);

  // Verify a manually-entered name against the SPECTER registry.
  const verify = useCallback(async (raw: string) => {
    const candidate = raw.trim().toLowerCase();
    const id = ++reqId.current;
    if (!candidate) {
      setStatus("idle");
      return;
    }
    if (!isValidRecipientName(candidate)) {
      setStatus("invalid");
      return;
    }
    const isSui = candidate.endsWith(".sui");
    setStatus("checking");
    try {
      if (isSui) await api.resolveSuins(candidate);
      else await api.resolveEns(candidate);
      if (id !== reqId.current) return; // a newer keystroke superseded this check
      setStatus("registered");
      analytics.payLinkNameVerified(isSui ? "sui" : "ens");
    } catch (err) {
      if (id !== reqId.current) return;
      const notRegistered =
        err instanceof ApiError && (NOT_REGISTERED_CODES.has(err.code ?? "") || err.status === 404);
      if (notRegistered) {
        setStatus("unregistered");
        analytics.payLinkNameUnregistered(isSui ? "sui" : "ens");
      } else {
        setStatus("error");
      }
    }
  }, []);

  // Debounce verification as the user types.
  useEffect(() => {
    if (!isManualEntry) return;
    const candidate = name.trim().toLowerCase();
    if (!candidate) {
      setStatus("idle");
      return;
    }
    if (!isValidRecipientName(candidate)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    const t = setTimeout(() => verify(candidate), VERIFY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [name, isManualEntry, verify]);

  async function handleShare() {
    analytics.payLinkShared("card");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Pay me on SPECTER", url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // dismissed — silent
        // genuine failure: fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      /* clipboard unavailable — fail silently */
    }
  }

  return (
    <Card className={cn("w-full overflow-hidden", className)}>
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-sm shadow-primary/30">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Your pay link</h3>
            <p className="text-xs text-muted-foreground">Share it anywhere to get paid privately</p>
          </div>
          <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
            private by default
          </Badge>
        </div>

        {/* Manual name entry (no stored name) with live verification */}
        {isManualEntry && (
          <div className="space-y-1.5">
            <label htmlFor="paylink-name" className="text-xs text-muted-foreground">
              Your registered name
            </label>
            <div className="relative">
              <Input
                id="paylink-name"
                value={name}
                onChange={(e) => setName(e.target.value.trim())}
                placeholder="alice.eth or bob.sui"
                className="font-mono text-sm pr-9"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {status === "registered" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {status === "unregistered" && <AlertCircle className="h-4 w-4 text-amber-500" />}
              </div>
            </div>
            {status === "invalid" && (
              <p className="text-xs text-muted-foreground">Enter a name ending in .eth or .sui</p>
            )}
            {status === "checking" && <p className="text-xs text-muted-foreground">Checking SPECTER…</p>}
            {status === "error" && (
              <button
                type="button"
                onClick={() => verify(name)}
                className="text-xs text-primary hover:underline"
              >
                Couldn't verify right now — try again
              </button>
            )}
          </div>
        )}

        {/* Not set up on SPECTER → minimal setup suggestion */}
        {status === "unregistered" && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <UserPlus className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  <span className="font-mono">{name.toLowerCase()}</span> isn't on SPECTER yet
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Set it up to start receiving private, post-quantum payments at this name.
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="w-full" onClick={() => analytics.payLinkSetupCtaClicked()}>
              <Link to="/setup">
                Set up SPECTER <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        )}

        {/* Registered → the shareable link, QR, and actions */}
        {status === "registered" && url && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate font-mono text-xs">{url}</span>
              <CopyButton
                text={url}
                onCopied={() => analytics.payLinkCopied("card")}
                showLabel={false}
                className="ml-auto"
              />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Every payer gets a fresh, unlinkable stealth address — your link never exposes a reusable
              address.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowQr((s) => !s)}>
                <QrIcon className="h-4 w-4 mr-1.5" /> {showQr ? "Hide QR" : "Show QR"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  analytics.requestBuilderOpened();
                  setDrawerOpen(true);
                }}
              >
                Request an amount
              </Button>
            </div>

            {showQr && (
              <div className="flex flex-col items-center gap-3 pt-1 animate-in fade-in zoom-in-95 duration-200">
                <QrCode value={url} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    analytics.payLinkQrDownloaded("card");
                    downloadQrPng(url, `specter-${name.toLowerCase()}`);
                  }}
                >
                  <Download className="h-4 w-4 mr-1.5" /> Download QR
                </Button>
              </div>
            )}

            <RequestPaymentDrawer open={drawerOpen} onOpenChange={setDrawerOpen} recipient={name.toLowerCase()} />
          </div>
        )}

        {/* No name yet and nothing typed */}
        {status === "idle" && !isManualEntry && (
          <p className="text-xs text-muted-foreground">
            Register an ENS or SuiNS name in Setup to get your shareable pay link.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
