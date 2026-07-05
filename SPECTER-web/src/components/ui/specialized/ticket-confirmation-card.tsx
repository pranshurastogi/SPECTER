import * as React from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { cn, formatCryptoAmount } from "@/lib/utils";

// --- Helper Components ---

const DashedLine = () => (
  <div
    className="w-full border-t-2 border-dashed border-border"
    aria-hidden="true"
  />
);

const Barcode = ({ value }: { value: string }) => {
  const hashCode = (s: string) =>
    s.split("").reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
  const seed = hashCode(value);
  const random = (s: number) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  const bars = Array.from({ length: 60 }).map((_, index) => {
    const rand = random(seed + index);
    const width = rand > 0.7 ? 2.5 : 1.5;
    return { width };
  });

  const spacing = 1.5;
  const totalWidth =
    bars.reduce((acc, bar) => acc + bar.width + spacing, 0) - spacing;
  const svgWidth = 250;
  const svgHeight = 70;
  let currentX = (svgWidth - totalWidth) / 2;

  return (
    <div className="flex flex-col items-center py-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        aria-label={`Barcode for value ${value}`}
        className="fill-current text-foreground"
      >
        {bars.map((bar, index) => {
          const x = currentX;
          currentX += bar.width + spacing;
          return (
            <rect
              key={index}
              x={x}
              y="10"
              width={bar.width}
              height="50"
            />
          );
        })}
      </svg>
      <p className="text-sm text-muted-foreground tracking-[0.3em] mt-2">
        {value}
      </p>
    </div>
  );
};

const ConfettiExplosion = () => {
  const confettiCount = 100;
  const colors = [
    "#ef4444",
    "#3b82f6",
    "#22c55e",
    "#eab308",
    "#8b5cf6",
    "#f97316",
  ];

  return (
    <>
      <style>
        {`
          @keyframes fall {
            0%   { transform: translateY(-5vh) rotate(0deg) translateX(0px);   opacity: 1; }
            25%  { transform: translateY(25vh) rotate(180deg) translateX(12px); opacity: 1; }
            50%  { transform: translateY(55vh) rotate(360deg) translateX(-8px); opacity: 0.9; }
            75%  { transform: translateY(80vh) rotate(540deg) translateX(10px); opacity: 0.6; }
            100% { transform: translateY(115vh) rotate(720deg) translateX(-5px); opacity: 0; }
          }
        `}
      </style>
      <div className="fixed inset-0 z-[9999] pointer-events-none" aria-hidden="true">
        {Array.from({ length: confettiCount }).map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              width: `${4 + Math.random() * 6}px`,
              height: `${8 + Math.random() * 10}px`,
              left: `${Math.random() * 100}%`,
              top: `${-5 + Math.random() * 5}%`,
              backgroundColor: colors[i % colors.length],
              borderRadius: i % 3 === 0 ? '50%' : '2px',
              transform: `rotate(${Math.random() * 360}deg)`,
              animation: `fall ${2 + Math.random() * 3}s ${Math.random() * 1.5}s ease-in forwards`,
              opacity: 0.9,
            }}
          />
        ))}
      </div>
    </>
  );
};

// --- Main Ticket Component ---

/** One line in the optional "Claimed addresses" breakdown. */
export interface TicketAddressRow {
  address: string;
  /** Pre-formatted amount string (e.g. "0.1074"). */
  amount: string;
  /** Explorer URL for this address's transaction. */
  url?: string;
}

export interface TicketProps extends React.HTMLAttributes<HTMLDivElement> {
  ticketId: string;
  amount: number;
  date: Date;
  cardHolder: string;
  last4Digits: string;
  barcodeValue: string;
  /** Currency for amount display (default "USD"). Use "ETH" or "SUI" for crypto (shows icon). */
  currency?: string;
  icon?: React.ReactNode;
  /** Network + chain label, e.g. "Sui Testnet" or "Sepolia". */
  chainLabel?: string;
  /** Full payment ID (shown truncated). */
  paymentId?: string;
  /** Announcement registry ID. */
  announcementId?: string | number;
  /** Source-chain transaction hash. */
  txHash?: string;
  /** Explorer URL for txHash — renders as a hyperlink. */
  txUrl?: string;
  /** Monad announce() transaction hash. */
  monadTxHash?: string;
  /** Explorer URL for monadTxHash. */
  monadTxUrl?: string;
  /** Heading (default "Thank you!"). */
  title?: string;
  /** Sub-heading (default "Your ticket has been issued successfully"). */
  subtitle?: string;
  /** Label above the cardholder line (hidden when unset). */
  holderLabel?: string;
  /** Label above the ticket id (default "Ticket ID"). */
  ticketIdLabel?: string;
  /** Label above the amount (default "Amount"). */
  amountLabel?: string;
  /** Optional per-address breakdown (used by the claim receipt). */
  addresses?: TicketAddressRow[];
  /** Show the falling-confetti celebration (default true). */
  confetti?: boolean;
}

const AnimatedTicket = React.forwardRef<HTMLDivElement, TicketProps>(
  (
    {
      className,
      ticketId,
      amount,
      date,
      cardHolder,
      last4Digits,
      barcodeValue,
      currency = "USD",
      chainLabel,
      paymentId,
      announcementId,
      txHash,
      txUrl,
      monadTxHash,
      monadTxUrl,
      title = "Thank you!",
      subtitle = "Your ticket has been issued successfully",
      holderLabel,
      ticketIdLabel = "Ticket ID",
      amountLabel = "Amount",
      addresses,
      confetti = true,
      ...props
    },
    ref
  ) => {
    const [showConfetti, setShowConfetti] = React.useState(false);

    React.useEffect(() => {
      if (!confetti) return;
      const mountTimer = setTimeout(() => setShowConfetti(true), 100);
      const unmountTimer = setTimeout(() => setShowConfetti(false), 6000);
      return () => {
        clearTimeout(mountTimer);
        clearTimeout(unmountTimer);
      };
    }, [confetti]);

    const isCrypto = currency === "ETH" || currency === "SUI";
    const formattedAmount = isCrypto
      ? formatCryptoAmount(amount)
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
        }).format(amount);

    const formattedDate = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(",", " •");

    return (
      <>
        {showConfetti && <ConfettiExplosion />}
        <div
          ref={ref}
          className={cn(
            "relative w-full max-w-sm bg-card text-card-foreground rounded-2xl shadow-lg font-sans z-10",
            "animate-in fade-in-0 zoom-in-95 duration-500",
            className
          )}
          {...props}
        >
          {/* Ticket cut-out effect */}
          <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background" />
          <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background" />

          <div className="p-8 flex flex-col items-center text-center">
            <div className="p-3 bg-primary/10 rounded-full animate-in zoom-in-50 delay-300 duration-500">
              <CheckCircle2 className="w-10 h-10 text-primary animate-in zoom-in-75 delay-500 duration-500" />
            </div>
            <h1 className="text-2xl font-semibold mt-4">{title}</h1>
            <p className="text-muted-foreground mt-1">{subtitle}</p>
          </div>

          <div className="px-8 pb-8 space-y-6">
            <DashedLine />

            <div className="grid grid-cols-2 gap-4 text-left">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase">
                  {ticketIdLabel}
                </p>
                <p className="font-mono font-medium truncate" title={ticketId}>{ticketId}</p>
              </div>
              <div className="text-right min-w-0">
                <p className="text-xs text-muted-foreground uppercase">
                  {amountLabel}
                </p>
                <p className="font-semibold text-lg truncate">
                  {isCrypto ? `${formattedAmount} ${currency}` : formattedAmount}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase">
                Date & Time
              </p>
              <p className="font-medium">{formattedDate}</p>
            </div>

            {holderLabel && (
              <p className="text-xs text-muted-foreground uppercase -mb-4">{holderLabel}</p>
            )}
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="font-semibold font-mono truncate" title={cardHolder}>{cardHolder}</p>
            </div>

            {/* Optional per-address breakdown (claim receipt). */}
            {addresses && addresses.length > 0 && (
              <>
                <DashedLine />
                <div className="space-y-1.5 text-left">
                  <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                    Claimed addresses
                  </p>
                  {addresses.map((a) => (
                    <div
                      key={a.address}
                      className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-muted/40 text-xs"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="font-mono text-muted-foreground truncate flex-1" title={a.address}>
                        {a.address.slice(0, 8)}…{a.address.slice(-6)}
                      </span>
                      <span className="font-mono tabular-nums shrink-0">{a.amount}</span>
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                          aria-label="View transaction in explorer"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <DashedLine />

            <Barcode value={barcodeValue} />

            {/* Payment details — only rendered when at least one field is provided */}
            {(chainLabel || paymentId || announcementId != null || txHash || monadTxHash) && (
              <>
                <DashedLine />
                <div className="space-y-2 text-left">
                  <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground">
                    Transaction Details
                  </p>
                  <dl className="space-y-1.5">
                    {chainLabel && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-muted-foreground shrink-0">Network</dt>
                        <dd className="text-xs font-medium font-mono truncate text-right">{chainLabel}</dd>
                      </div>
                    )}
                    {announcementId != null && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-muted-foreground shrink-0">Announcement</dt>
                        <dd className="text-xs font-mono text-right">#{announcementId}</dd>
                      </div>
                    )}
                    {paymentId && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-muted-foreground shrink-0">Payment ID</dt>
                        <dd className="text-xs font-mono text-right truncate max-w-[160px]" title={paymentId}>
                          {paymentId.slice(0, 8)}…{paymentId.slice(-6)}
                        </dd>
                      </div>
                    )}
                    {txHash && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-muted-foreground shrink-0">Tx</dt>
                        <dd className="text-xs font-mono text-right flex items-center gap-1 min-w-0">
                          <span className="truncate" title={txHash}>
                            {txHash.slice(0, 10)}…{txHash.slice(-6)}
                          </span>
                          {txUrl && (
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                              aria-label="View transaction in explorer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </dd>
                      </div>
                    )}
                    {monadTxHash && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-xs text-muted-foreground shrink-0">Monad announce</dt>
                        <dd className="text-xs font-mono text-right flex items-center gap-1 min-w-0">
                          <span className="truncate" title={monadTxHash}>
                            {monadTxHash.slice(0, 10)}…{monadTxHash.slice(-6)}
                          </span>
                          {monadTxUrl && (
                            <a
                              href={monadTxUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                              aria-label="View Monad announcement in explorer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }
);

AnimatedTicket.displayName = "AnimatedTicket";

export { AnimatedTicket };
