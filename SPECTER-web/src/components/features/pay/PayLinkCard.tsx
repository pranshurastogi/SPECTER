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
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/base/card";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { QrCode, downloadQrPng } from "@/components/ui/specialized/qr-code";
import { RequestPaymentDrawer } from "./RequestPaymentDrawer";
import { getRegisteredName } from "@/lib/setupProgress";
import { buildPayUrl, isValidRecipientName } from "@/lib/payLink";
import { getMyPayNames, addMyPayName, clearMyPayNames } from "@/lib/myPayNames";
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

/* Dark Knight palette — scoped to this card so it reads like a sealed object,
 * not a slice of the app chrome. Void graphite surface, one signal-gold accent. */
const goldBtn =
  "bg-[#F2C94C] text-[#0B0D10] hover:bg-[#E5BE43] focus-visible:ring-[#F2C94C] border-0";
const ghostBtn =
  "border border-[#2A2E37] bg-transparent text-[#C7CBD2] hover:bg-[#15181E] hover:text-white";

export function PayLinkCard({ source, className }: { source: "scan" | "setup"; className?: string }) {
  // A stored name comes from a completed setup, so it's already known-registered.
  const storedName = useMemo(() => getRegisteredName(), []);
  const isManualEntry = !storedName;

  const [name, setName] = useState<string>(storedName ?? "");
  const [status, setStatus] = useState<VerifyStatus>(storedName ? "registered" : "idle");
  const [showQr, setShowQr] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reqId = useRef(0);

  // Locally-remembered names this person has used for their own pay link,
  // surfaced as suggestions next time — same pattern as the Send section.
  const [savedNames, setSavedNames] = useState<string[]>(() => {
    try { return getMyPayNames().map((r) => r.name); } catch { return []; }
  });
  const [inputFocused, setInputFocused] = useState(false);

  const rememberName = useCallback((value: string) => {
    addMyPayName(value);
    setSavedNames(getMyPayNames().map((r) => r.name));
  }, []);

  // Suggestions = remembered names that match what's typed (or all, when empty),
  // minus an exact match of the current value.
  const typed = name.trim().toLowerCase();
  const suggestions = useMemo(
    () => savedNames.filter((n) => n !== typed && (!typed || n.includes(typed))),
    [savedNames, typed]
  );
  const showSuggestions = isManualEntry && inputFocused && suggestions.length > 0;

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
      rememberName(candidate);
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
  }, [rememberName]);

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
    <Card
      className={cn(
        "w-full overflow-hidden border-[#1E222A] bg-[#0B0D10] text-[#EDEEF0]",
        className
      )}
    >
      {/* Bat-signal: a single gold beam across the top is the card's one bold note. */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#F2C94C]/70 to-transparent" />
      <CardContent className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#F2C94C]/30 bg-[#F2C94C]/10 text-[#F2C94C]">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight text-[#F4F5F7]">Your pay link</h3>
            <p className="text-xs text-[#878C96]">Share anywhere to get paid privately</p>
          </div>
          <span className="ml-auto shrink-0 rounded-full border border-[#23262E] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#878C96]">
            private
          </span>
        </div>

        {/* Manual name entry (no stored name) with live verification */}
        {isManualEntry && (
          <div className="space-y-1.5">
            <label htmlFor="paylink-name" className="text-xs text-[#878C96]">
              Your registered name
            </label>
            <div className="relative">
              <Input
                id="paylink-name"
                value={name}
                onChange={(e) => setName(e.target.value.trim())}
                onFocus={() => setInputFocused(true)}
                // Delay so a suggestion click (onMouseDown) registers before close.
                onBlur={() => window.setTimeout(() => setInputFocused(false), 120)}
                placeholder="alice.eth or bob.sui"
                className="border-[#23262E] bg-[#111317] font-mono text-sm text-[#EDEEF0] placeholder:text-[#5B616B] pr-9 focus-visible:ring-[#F2C94C]/60"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-[#878C96]" />}
                {status === "registered" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {status === "unregistered" && <AlertCircle className="h-4 w-4 text-[#F2C94C]" />}
              </div>
            </div>

            {/* Remembered names — rendered inline (not absolute) so the card's
                overflow-hidden can't clip them and every row stays clickable. */}
            {showSuggestions && (
              <div className="overflow-hidden rounded-lg border border-[#23262E] bg-[#0E1014] animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-[#5B616B]">Recent names</span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearMyPayNames();
                      setSavedNames([]);
                    }}
                    className="text-[10px] text-[#878C96] hover:text-[#F2C94C]"
                  >
                    Clear
                  </button>
                </div>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    // onMouseDown beats the input's onBlur, so the value sticks.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setName(s);
                      setInputFocused(false);
                      void verify(s);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-sm text-[#C7CBD2] hover:bg-[#15181E] hover:text-white"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-[#5B616B]" />
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
            )}
            {status === "invalid" && (
              <p className="text-xs text-[#878C96]">Enter a name ending in .eth or .sui</p>
            )}
            {status === "checking" && <p className="text-xs text-[#878C96]">Checking SPECTER…</p>}
            {status === "error" && (
              <button
                type="button"
                onClick={() => verify(name)}
                className="text-xs text-[#F2C94C] hover:underline"
              >
                Couldn't verify right now — try again
              </button>
            )}
          </div>
        )}

        {/* Not set up on SPECTER → minimal setup suggestion */}
        {status === "unregistered" && (
          <div className="rounded-xl border border-[#F2C94C]/20 bg-[#F2C94C]/[0.06] p-4 space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F2C94C]/15 text-[#F2C94C]">
                <UserPlus className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-[#F4F5F7]">
                  <span className="font-mono">{name.toLowerCase()}</span> isn't on SPECTER yet
                </p>
                <p className="text-xs text-[#878C96] leading-relaxed">
                  Set it up to start receiving private, post-quantum payments at this name.
                </p>
              </div>
            </div>
            <Button
              asChild
              size="sm"
              className={cn("w-full", goldBtn)}
              onClick={() => analytics.payLinkSetupCtaClicked()}
            >
              <Link to="/setup">
                Set up SPECTER <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        )}

        {/* Registered → the shareable link, QR, and actions */}
        {status === "registered" && url && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 rounded-lg border border-[#23262E] bg-[#111317] px-3 py-2.5">
              <Link2 className="h-3.5 w-3.5 text-[#F2C94C] shrink-0" />
              <span className="truncate font-mono text-xs text-[#C7CBD2]">{url}</span>
              <CopyButton
                text={url}
                onCopied={() => analytics.payLinkCopied("card")}
                showLabel={false}
                className="ml-auto text-[#878C96] hover:text-white"
              />
            </div>

            <p className="text-xs text-[#878C96] leading-relaxed">
              Every payer gets a fresh, unlinkable stealth address — your link never exposes a reusable
              one.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className={ghostBtn} onClick={() => setShowQr((s) => !s)}>
                <QrIcon className="h-4 w-4 mr-1.5" /> {showQr ? "Hide QR" : "Show QR"}
              </Button>
              <Button size="sm" className={ghostBtn} onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
            </div>

            {showQr && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-[#23262E] bg-[#111317] p-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="rounded-lg bg-white p-2">
                  <QrCode value={url} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[#C7CBD2] hover:bg-[#15181E] hover:text-white"
                  onClick={() => {
                    analytics.payLinkQrDownloaded("card");
                    downloadQrPng(url, `specter-${name.toLowerCase()}`);
                  }}
                >
                  <Download className="h-4 w-4 mr-1.5" /> Download QR
                </Button>
              </div>
            )}

            <Button
              size="sm"
              className={cn("w-full", goldBtn)}
              onClick={() => {
                analytics.requestBuilderOpened();
                setDrawerOpen(true);
              }}
            >
              Request an amount
            </Button>

            <RequestPaymentDrawer open={drawerOpen} onOpenChange={setDrawerOpen} recipient={name.toLowerCase()} />
          </div>
        )}

        {/* No name yet and nothing typed */}
        {status === "idle" && !isManualEntry && (
          <p className="text-xs text-[#878C96]">
            Register an ENS or SuiNS name in Setup to get your shareable pay link.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
